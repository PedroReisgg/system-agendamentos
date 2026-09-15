import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { pool, query } from './db.js';
import { requireAuth, allow, requireStaff, requireManager, sign } from './auth.js';
import { sendVerificationEmail } from './mailer.js';

const app = express();
const activeStatuses = ['pending', 'confirmed', 'rescheduled'];
const validStatuses = [...activeStatuses, 'cancelled'];
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const fail = (res, status, error) => res.status(status).json({ error });

const allowedOrigins = process.env.FRONTEND_URL?.split(',').map((item) => item.trim()).filter(Boolean) || [];
app.use(cors({ origin(origin, callback) {
  if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origem não autorizada pelo CORS.'));
} }));
app.use(express.json());

const sqlTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
const minutesFromTime = (value) => {
  const [hour, minute] = String(value).slice(0, 5).split(':').map(Number);
  return hour * 60 + minute;
};
const localNow = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { date: `${value.year}-${value.month}-${value.day}`, minutes: Number(value.hour) * 60 + Number(value.minute) };
};
const nextSlotAtOrAfter = (minutes, interval = 30) => Math.ceil(minutes / interval) * interval;
const isManager = (auth) => ['admin', 'cashier'].includes(auth.role) || auth.staffAccessLevel === 'manager';
const isProfessionalActor = (auth, professional) => isManager(auth) || professional.user_id === auth.sub;

async function getProfessionalForTenant(db, professionalId, tenantId) {
  const [rows] = await db.execute(
    'SELECT p.id, p.user_id FROM professionals p WHERE p.id = ? AND p.tenant_id = ? AND p.active = 1',
    [professionalId, tenantId]
  );
  return rows[0];
}

async function reserveSlot(db, payload, auth) {
  const { professionalId, serviceId, appointmentDate, startTime, excludeAppointmentId = null } = payload;
  if (!professionalId || !serviceId || !appointmentDate || !timePattern.test(startTime || '')) {
    throw Object.assign(new Error('Dados de agendamento inválidos.'), { status: 400 });
  }
  const now = localNow();
  if (appointmentDate < now.date) throw Object.assign(new Error('Não é possível agendar em uma data passada.'), { status: 400 });
  if (appointmentDate === now.date && minutesFromTime(startTime) < nextSlotAtOrAfter(now.minutes + Number(process.env.BOOKING_BUFFER_MINUTES || 30))) throw Object.assign(new Error('Este horário não respeita a antecedência mínima para hoje.'), { status: 400 });

  const [services] = await db.execute(
    `SELECT s.duration_minutes
       FROM services s
       JOIN professional_services ps ON ps.service_id = s.id
       JOIN professionals p ON p.id = ps.professional_id
      WHERE s.id = ? AND p.id = ? AND s.tenant_id = ? AND p.tenant_id = ?
        AND s.active = 1 AND p.active = 1`,
    [serviceId, professionalId, auth.tenantId, auth.tenantId]
  );
  const service = services[0];
  if (!service) throw Object.assign(new Error('Serviço ou profissional inválido.'), { status: 400 });

  const startMinutes = minutesFromTime(startTime);
  const endMinutes = startMinutes + service.duration_minutes;
  if (endMinutes > 24 * 60) throw Object.assign(new Error('Horário inválido.'), { status: 400 });
  const endTime = sqlTime(endMinutes);

  const [hours] = await db.execute(
    `SELECT id FROM working_hours
      WHERE professional_id = ? AND day_of_week = (DAYOFWEEK(?) - 1)
        AND start_time <= ? AND end_time >= ?`,
    [professionalId, appointmentDate, `${startTime}:00`, endTime]
  );
  if (!hours[0]) throw Object.assign(new Error('Horário fora da agenda do profissional.'), { status: 400 });

  const lockName = `agenda:${professionalId}:${appointmentDate}`;
  const [locks] = await db.execute('SELECT GET_LOCK(?, 5) AS locked', [lockName]);
  if (Number(locks[0]?.locked) !== 1) throw Object.assign(new Error('Não foi possível reservar o horário. Tente novamente.'), { status: 409 });

  try {
    const params = [professionalId, appointmentDate, endTime, `${startTime}:00`, ...activeStatuses];
    let exclusion = '';
    if (excludeAppointmentId) {
      exclusion = ' AND id <> ?';
      params.push(excludeAppointmentId);
    }
    const placeholders = activeStatuses.map(() => '?').join(',');
    const [conflicts] = await db.execute(
      `SELECT id FROM appointments
        WHERE professional_id = ? AND appointment_date = ?
          AND start_time < ? AND end_time > ? AND status IN (${placeholders})${exclusion}
        LIMIT 1`,
      params
    );
    if (conflicts[0]) throw Object.assign(new Error('Horário não está mais disponível.'), { status: 409 });
    return { endTime };
  } finally {
    await db.execute('SELECT RELEASE_LOCK(?)', [lockName]);
  }
}

async function ensureStaffAccess(db, auth, professionalId) {
  const professional = await getProfessionalForTenant(db, professionalId, auth.tenantId);
  if (!professional) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404 });
  if (!isProfessionalActor(auth, professional)) throw Object.assign(new Error('Sem permissão para esta agenda.'), { status: 403 });
  return professional;
}

app.get('/health', async (_, res) => {
  try { await query('SELECT 1'); res.json({ ok: true }); }
  catch { fail(res, 503, 'Banco de dados indisponível.'); }
});

app.get('/api/public/tenants/:slug', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, name, slug, config_json FROM tenants WHERE slug = ?', [req.params.slug]);
    return rows[0] ? res.json(rows[0]) : fail(res, 404, 'Empresa não encontrada.');
  } catch (error) { next(error); }
});
app.get('/api/public/:slug/services', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT s.id, s.name, s.description, s.price, s.duration_minutes FROM services s JOIN tenants t ON t.id = s.tenant_id WHERE t.slug = ? AND s.active = 1 ORDER BY s.name',
      [req.params.slug]
    );
    res.json(rows);
  } catch (error) { next(error); }
});
app.get('/api/public/:slug/professionals', async (req, res, next) => {
  try {
    const { serviceId, date } = req.query;
    const params = [req.params.slug];
    let serviceFilter = '';
    let dateFilter = '';
    if (serviceId) { serviceFilter = ' AND ps.service_id = ?'; params.push(serviceId); }
    if (date) { dateFilter = ' AND EXISTS (SELECT 1 FROM working_hours wh WHERE wh.professional_id = p.id AND wh.day_of_week = (DAYOFWEEK(?) - 1))'; params.push(date); }
    const { rows } = await query(
      `SELECT p.id, u.name, p.bio FROM professionals p
       JOIN users u ON u.id = p.user_id
       JOIN tenants t ON t.id = p.tenant_id
       JOIN professional_services ps ON ps.professional_id = p.id
       WHERE t.slug = ? AND p.active = 1${serviceFilter}${dateFilter}
       GROUP BY p.id, u.name, p.bio ORDER BY u.name`, params
    );
    res.json(rows);
  } catch (error) { next(error); }
});
app.get('/api/public/availability', async (req, res, next) => {
  try {
    const { professionalId, serviceId, date } = req.query;
    if (!professionalId || !serviceId || !date) return fail(res, 400, 'professionalId, serviceId e date são obrigatórios.');
    const { rows: serviceRows } = await query(
      'SELECT s.duration_minutes FROM services s JOIN professional_services ps ON ps.service_id = s.id WHERE s.id = ? AND ps.professional_id = ? AND s.active = 1',
      [serviceId, professionalId]
    );
    const service = serviceRows[0];
    if (!service) return fail(res, 404, 'Serviço não disponível para este profissional.');
    const { rows: hours } = await query('SELECT start_time, end_time FROM working_hours WHERE professional_id = ? AND day_of_week = (DAYOFWEEK(?) - 1)', [professionalId, date]);
    const { rows: appointments } = await query(
      `SELECT start_time, end_time FROM appointments WHERE professional_id = ? AND appointment_date = ? AND status IN (${activeStatuses.map(() => '?').join(',')})`,
      [professionalId, date, ...activeStatuses]
    );
    const now = localNow();
    if (date < now.date) return res.json([]);
    const minimumStart = date === now.date ? nextSlotAtOrAfter(now.minutes + Number(process.env.BOOKING_BUFFER_MINUTES || 30)) : 0;
    const slots = [];
    for (const work of hours) {
      const workEnd = minutesFromTime(work.end_time);
      for (let start = minutesFromTime(work.start_time); start + service.duration_minutes <= workEnd; start += 30) {
        const end = start + service.duration_minutes;
        const overlaps = appointments.some((appointment) => start < minutesFromTime(appointment.end_time) && end > minutesFromTime(appointment.start_time));
        if (!overlaps && start >= minimumStart) slots.push({ start_time: sqlTime(start).slice(0, 5), end_time: sqlTime(end).slice(0, 5) });
      }
    }
    res.json(slots);
  } catch (error) { next(error); }
});

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { tenantSlug, name, email, password, phone, gender, favoriteServices = [] } = req.body;
    if (!tenantSlug || !name || !email || !password || !phone || !gender) return fail(res, 400, 'Campos obrigatórios ausentes.');
    if (!/^\+[1-9]\d{7,14}$/.test(phone) || password.length < 8) return fail(res, 400, 'Telefone E.164 ou senha inválidos.');
    const { rows: tenants } = await query('SELECT id FROM tenants WHERE slug = ?', [tenantSlug]);
    if (!tenants[0]) return fail(res, 404, 'Empresa não encontrada.');
    const token = crypto.randomBytes(32).toString('hex');
    try {
      await query(
        'INSERT INTO users (id, tenant_id, name, email, password_hash, phone, gender, verification_token, favorite_services) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), tenants[0].id, name.trim(), email.toLowerCase(), await bcrypt.hash(password, 12), phone, gender, token, JSON.stringify(favoriteServices)]
      );
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'E-mail já cadastrado.');
      throw error;
    }
    const delivery = await sendVerificationEmail(email, token);
    res.status(201).json({
      message: delivery.delivered ? 'Cadastro criado. Verifique seu e-mail.' : 'Cadastro criado. Use o link de desenvolvimento para confirmar.',
      developmentVerificationUrl: process.env.NODE_ENV === 'production' || delivery.delivered ? undefined : delivery.url
    });
  } catch (error) { next(error); }
});
app.get('/api/auth/verify-email', async (req, res, next) => {
  try {
    const { rows } = await query('UPDATE users SET email_verified_at = NOW(), verification_token = NULL WHERE verification_token = ? AND email_verified_at IS NULL', [req.query.token]);
    return rows.affectedRows ? res.json({ message: 'E-mail confirmado.' }) : fail(res, 400, 'Token inválido ou já utilizado.');
  } catch (error) { next(error); }
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { rows } = await query('SELECT * FROM users WHERE email = ?', [email?.toLowerCase()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) return fail(res, 401, 'E-mail ou senha incorretos.');
    if (!user.email_verified_at) return fail(res, 403, 'Confirme seu e-mail antes de entrar.');
    res.json({ token: sign(user), user: { id: user.id, name: user.name, role: user.role, staffAccessLevel: user.staff_access_level, tenantId: user.tenant_id } });
  } catch (error) { next(error); }
});

app.post('/api/appointments', requireAuth, allow('client'), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { endTime } = await reserveSlot(connection, req.body, req.auth);
    const id = crypto.randomUUID();
    await connection.execute(
      'INSERT INTO appointments (id, tenant_id, client_id, professional_id, service_id, appointment_date, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, req.auth.tenantId, req.auth.sub, req.body.professionalId, req.body.serviceId, req.body.appointmentDate, `${req.body.startTime}:00`, endTime, 'pending']
    );
    await connection.commit();
    const [rows] = await connection.execute('SELECT * FROM appointments WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});
app.get('/api/appointments/mine', requireAuth, allow('client'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, s.name service_name, u.name professional_name FROM appointments a
       JOIN services s ON s.id = a.service_id JOIN professionals p ON p.id = a.professional_id JOIN users u ON u.id = p.user_id
       WHERE a.client_id = ? ORDER BY a.appointment_date DESC, a.start_time DESC`, [req.auth.sub]
    );
    res.json(rows);
  } catch (error) { next(error); }
});
app.patch('/api/appointments/:id/reschedule', requireAuth, allow('client'), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [owned] = await connection.execute(
      `SELECT * FROM appointments WHERE id = ? AND client_id = ? AND appointment_date >= CURDATE()
       AND status IN (${activeStatuses.map(() => '?').join(',')}) FOR UPDATE`,
      [req.params.id, req.auth.sub, ...activeStatuses]
    );
    if (!owned[0]) throw Object.assign(new Error('Agendamento não encontrado ou não pode ser remarcado.'), { status: 404 });
    const payload = { ...req.body, professionalId: owned[0].professional_id, serviceId: owned[0].service_id, excludeAppointmentId: req.params.id };
    const { endTime } = await reserveSlot(connection, payload, req.auth);
    await connection.execute("UPDATE appointments SET appointment_date = ?, start_time = ?, end_time = ?, status = 'rescheduled' WHERE id = ?", [payload.appointmentDate, `${payload.startTime}:00`, endTime, req.params.id]);
    await connection.commit();
    const [rows] = await connection.execute('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

app.get('/api/staff/professionals', requireAuth, requireStaff, async (req, res, next) => {
  try {
    const filters = ['admin', 'cashier'].includes(req.auth.role) ? [req.auth.tenantId] : [req.auth.tenantId, req.auth.sub];
    const scope = ['admin', 'cashier'].includes(req.auth.role) ? '' : ' AND p.user_id = ?';
    const { rows } = await query(
      `SELECT p.id, p.bio, u.name, COUNT(DISTINCT ps.service_id) AS service_count
       FROM professionals p JOIN users u ON u.id = p.user_id LEFT JOIN professional_services ps ON ps.professional_id = p.id
       WHERE p.tenant_id = ? AND p.active = 1${scope} GROUP BY p.id, p.bio, u.name ORDER BY u.name`, filters
    );
    res.json(rows);
  } catch (error) { next(error); }
});
app.get('/api/staff/clients', requireAuth, requireStaff, requireManager, async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const params = [req.auth.tenantId];
    const filter = search ? ' AND (name LIKE ? OR phone LIKE ?)' : '';
    if (search) params.push(`%${search}%`, `%${search}%`);
    const { rows } = await query(`SELECT id, name, phone, email FROM users WHERE tenant_id = ? AND role = 'client'${filter} ORDER BY name LIMIT 100`, params);
    res.json(rows);
  } catch (error) { next(error); }
});
app.get('/api/staff/appointments', requireAuth, requireStaff, async (req, res, next) => {
  try {
    const { professionalId, date } = req.query;
    if (!professionalId || !date) return fail(res, 400, 'professionalId e date são obrigatórios.');
    await ensureStaffAccess(pool, req.auth, professionalId);
    const { rows } = await query(
      `SELECT a.*, c.name client_name, c.phone client_phone, c.email client_email, s.name service_name,
         CONCAT('https://wa.me/', REPLACE(REPLACE(c.phone, '+', ''), ' ', ''), '?text=', REPLACE(CONCAT('Olá ', c.name, ', sobre seu horário no salão.'), ' ', '%20')) AS whatsapp_url
       FROM appointments a JOIN users c ON c.id = a.client_id JOIN services s ON s.id = a.service_id
       WHERE a.tenant_id = ? AND a.professional_id = ? AND a.appointment_date = ?
       ORDER BY a.start_time`, [req.auth.tenantId, professionalId, date]
    );
    res.json(rows);
  } catch (error) { next(error); }
});
app.get('/api/staff/notifications', requireAuth, requireStaff, async (req, res, next) => {
  try {
    const since = req.query.since || '1970-01-01 00:00:00';
    const params = [req.auth.tenantId, since];
    const scope = ['admin', 'cashier'].includes(req.auth.role) ? '' : ' AND p.user_id = ?';
    if (!['admin', 'cashier'].includes(req.auth.role)) params.push(req.auth.sub);
    const { rows } = await query(
      `SELECT a.id, a.appointment_date, a.start_time, a.created_at, c.name AS client_name, s.name AS service_name, u.name AS professional_name
       FROM appointments a JOIN users c ON c.id = a.client_id JOIN services s ON s.id = a.service_id
       JOIN professionals p ON p.id = a.professional_id JOIN users u ON u.id = p.user_id
       WHERE a.tenant_id = ? AND a.created_at > ?${scope} ORDER BY a.created_at DESC LIMIT 20`, params
    );
    res.json(rows);
  } catch (error) { next(error); }
});
app.post('/api/staff/appointments', requireAuth, requireStaff, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const { clientId, professionalId, serviceId, appointmentDate, startTime } = req.body;
    if (!clientId) throw Object.assign(new Error('Selecione o cliente.'), { status: 400 });
    await connection.beginTransaction();
    await ensureStaffAccess(connection, req.auth, professionalId);
    const [clients] = await connection.execute("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role = 'client'", [clientId, req.auth.tenantId]);
    if (!clients[0]) throw Object.assign(new Error('Cliente não encontrado.'), { status: 404 });
    const { endTime } = await reserveSlot(connection, { professionalId, serviceId, appointmentDate, startTime }, req.auth);
    const id = crypto.randomUUID();
    await connection.execute(
      'INSERT INTO appointments (id, tenant_id, client_id, professional_id, service_id, appointment_date, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, req.auth.tenantId, clientId, professionalId, serviceId, appointmentDate, `${startTime}:00`, endTime, req.body.status === 'pending' ? 'pending' : 'confirmed']
    );
    await connection.commit();
    res.status(201).json({ id });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});
app.patch('/api/staff/appointments/:id', requireAuth, requireStaff, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    if (req.auth.role === 'cashier' && Object.keys(req.body).some((key) => key !== 'status')) throw Object.assign(new Error('O caixa só pode alterar o status.'), { status: 403 });
    await connection.beginTransaction();
    const [existingRows] = await connection.execute('SELECT * FROM appointments WHERE id = ? AND tenant_id = ? FOR UPDATE', [req.params.id, req.auth.tenantId]);
    const existing = existingRows[0];
    if (!existing) throw Object.assign(new Error('Agendamento não encontrado.'), { status: 404 });
    if (!isManager(req.auth) && String(existing.appointment_date).slice(0, 10) < localNow().date) throw Object.assign(new Error('Datas passadas ou fechadas não podem ser alteradas.'), { status: 403 });
    await ensureStaffAccess(connection, req.auth, existing.professional_id);
    const payload = {
      clientId: req.body.clientId || existing.client_id,
      professionalId: req.body.professionalId || existing.professional_id,
      serviceId: req.body.serviceId || existing.service_id,
      appointmentDate: req.body.appointmentDate || String(existing.appointment_date).slice(0, 10),
      startTime: req.body.startTime || String(existing.start_time).slice(0, 5),
      status: req.body.status || existing.status,
      excludeAppointmentId: existing.id
    };
    if (!validStatuses.includes(payload.status)) throw Object.assign(new Error('Status inválido.'), { status: 400 });
    await ensureStaffAccess(connection, req.auth, payload.professionalId);
    const [clients] = await connection.execute("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role = 'client'", [payload.clientId, req.auth.tenantId]);
    if (!clients[0]) throw Object.assign(new Error('Cliente não encontrado.'), { status: 404 });
    const { endTime } = activeStatuses.includes(payload.status)
      ? await reserveSlot(connection, payload, req.auth)
      : { endTime: existing.end_time };
    await connection.execute(
      'UPDATE appointments SET client_id = ?, professional_id = ?, service_id = ?, appointment_date = ?, start_time = ?, end_time = ?, status = ? WHERE id = ?',
      [payload.clientId, payload.professionalId, payload.serviceId, payload.appointmentDate, `${payload.startTime}:00`, endTime, payload.status, existing.id]
    );
    await connection.commit();
    res.json({ id: existing.id });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});
app.delete('/api/staff/appointments/:id', requireAuth, requireStaff, requireManager, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT professional_id FROM appointments WHERE id = ? AND tenant_id = ? FOR UPDATE', [req.params.id, req.auth.tenantId]);
    if (!rows[0]) throw Object.assign(new Error('Agendamento não encontrado.'), { status: 404 });
    await ensureStaffAccess(connection, req.auth, rows[0].professional_id);
    await connection.execute('DELETE FROM appointments WHERE id = ?', [req.params.id]);
    await connection.commit();
    res.status(204).end();
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

app.get('/api/staff/users', requireAuth, requireStaff, requireManager, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT id, name, email, phone, role, staff_access_level, job_title FROM users WHERE tenant_id = ? AND role IN ('admin', 'cashier', 'professional') ORDER BY name", [req.auth.tenantId]);
    res.json(rows);
  } catch (error) { next(error); }
});
app.post('/api/staff/users', requireAuth, requireStaff, requireManager, async (req, res, next) => {
  try {
    const { name, email, phone, gender = 'OUTRO', role = 'professional', staffAccessLevel = 'viewer', jobTitle = '', password } = req.body;
    if (!name || !email || !phone || !password || password.length < 3) return fail(res, 400, 'Nome, e-mail, telefone e senha são obrigatórios.');
    if (!['admin', 'cashier', 'professional'].includes(role) || !['viewer', 'manager'].includes(staffAccessLevel)) return fail(res, 400, 'Função ou nível inválido.');
    const id = crypto.randomUUID();
    await query('INSERT INTO users (id, tenant_id, name, email, password_hash, phone, gender, role, staff_access_level, job_title, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())', [id, req.auth.tenantId, name, email.toLowerCase(), await bcrypt.hash(password, 12), phone, gender, role, staffAccessLevel, jobTitle]);
    if (role === 'professional') await query('INSERT INTO professionals (id, tenant_id, user_id, active) VALUES (?, ?, ?, 1)', [crypto.randomUUID(), req.auth.tenantId, id]);
    res.status(201).json({ id });
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'E-mail já cadastrado.'); next(error); }
});
app.patch('/api/staff/users/:id', requireAuth, requireStaff, requireManager, async (req, res, next) => {
  try {
    if (req.auth.sub === req.params.id && req.body.staffAccessLevel === 'viewer') return fail(res, 400, 'Você não pode remover seu próprio nível de gestor.');
    const { name, email, phone, gender, role, staffAccessLevel, jobTitle, password } = req.body;
    if (role && !['admin', 'cashier', 'professional'].includes(role)) return fail(res, 400, 'Função inválida.');
    if (staffAccessLevel && !['viewer', 'manager'].includes(staffAccessLevel)) return fail(res, 400, 'Nível inválido.');
    const fields = []; const values = [];
    for (const [column, value] of Object.entries({ name, email: email?.toLowerCase(), phone, gender, role, staff_access_level: staffAccessLevel, job_title: jobTitle })) if (value !== undefined) { fields.push(`${column} = ?`); values.push(value); }
    if (password !== undefined) { if (password.length < 3) return fail(res, 400, 'A senha precisa ter ao menos 3 caracteres.'); fields.push('password_hash = ?'); values.push(await bcrypt.hash(password, 12)); }
    if (!fields.length) return fail(res, 400, 'Nenhuma alteração informada.');
    values.push(req.params.id, req.auth.tenantId);
    const { rows } = await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ? AND role IN ('admin', 'cashier', 'professional')`, values);
    return rows.affectedRows ? res.json({ id: req.params.id }) : fail(res, 404, 'Funcionário não encontrado.');
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'E-mail já cadastrado.'); next(error); }
});
app.delete('/api/staff/users/:id', requireAuth, requireStaff, requireManager, async (req, res, next) => {
  try {
    if (req.auth.sub === req.params.id) return fail(res, 400, 'Você não pode excluir sua própria conta.');
    const { rows } = await query("DELETE FROM users WHERE id = ? AND tenant_id = ? AND role IN ('admin', 'cashier', 'professional')", [req.params.id, req.auth.tenantId]);
    return rows.affectedRows ? res.status(204).end() : fail(res, 404, 'Funcionário não encontrado.');
  } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') return fail(res, 409, 'Este funcionário possui vínculos no histórico e não pode ser excluído.'); next(error); }
});
app.get('/api/staff/professionals/:id/working-hours', requireAuth, requireStaff, async (req, res, next) => {
  try { await ensureStaffAccess(pool, req.auth, req.params.id); const { rows } = await query('SELECT id, day_of_week, start_time, end_time FROM working_hours WHERE professional_id = ? ORDER BY day_of_week, start_time', [req.params.id]); res.json(rows); }
  catch (error) { next(error); }
});
app.put('/api/staff/professionals/:id/working-hours', requireAuth, requireStaff, requireManager, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    if (!Array.isArray(req.body.hours)) return fail(res, 400, 'Envie a lista de horários.');
    await connection.beginTransaction();
    await ensureStaffAccess(connection, req.auth, req.params.id);
    await connection.execute('DELETE FROM working_hours WHERE professional_id = ?', [req.params.id]);
    for (const hour of req.body.hours) {
      if (!Number.isInteger(hour.dayOfWeek) || hour.dayOfWeek < 0 || hour.dayOfWeek > 6 || !timePattern.test(hour.startTime) || !timePattern.test(hour.endTime) || hour.endTime <= hour.startTime) throw Object.assign(new Error('Horário de trabalho inválido.'), { status: 400 });
      await connection.execute('INSERT INTO working_hours (professional_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)', [req.params.id, hour.dayOfWeek, `${hour.startTime}:00`, `${hour.endTime}:00`]);
    }
    await connection.commit(); res.status(204).end();
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

app.use((error, _, res, __) => {
  console.error(error);
  fail(res, error.status || 500, error.message || 'Erro interno.');
});
app.listen(process.env.PORT || 3001, () => console.log(`API em :${process.env.PORT || 3001}`));
