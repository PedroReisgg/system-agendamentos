import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../backend/src/db.js';

const tenantId = '00000000-0000-4000-8000-000000000001';
const accounts = [
  ['10000000-0000-4000-8000-000000000001', 'Dono Casa Âmbar', 'dono@casaambar.test', 'admin', 'manager'],
  ['10000000-0000-4000-8000-000000000002', 'Caixa Casa Âmbar', 'caixa@casaambar.test', 'cashier', 'manager'],
  ['10000000-0000-4000-8000-000000000003', 'Helena Cabeleireira', 'cabeleireiro@casaambar.test', 'professional', 'viewer']
];
const services = [
  ['20000000-0000-4000-8000-000000000001', 'Corte & finalização', 'Consulta, corte e acabamento.', 85, 60],
  ['20000000-0000-4000-8000-000000000002', 'Barba clássica', 'Toalha quente, desenho e finalização.', 55, 40],
  ['20000000-0000-4000-8000-000000000003', 'Ritual spa capilar', 'Tratamento e massagem.', 150, 75]
];
const professionalId = '30000000-0000-4000-8000-000000000001';
const passwordHash = await bcrypt.hash('123', 12);
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  await connection.execute("ALTER TABLE users MODIFY role ENUM('client', 'professional', 'cashier', 'admin') NOT NULL DEFAULT 'client', ADD COLUMN IF NOT EXISTS staff_access_level ENUM('viewer', 'manager') NULL DEFAULT NULL AFTER role, ADD COLUMN IF NOT EXISTS job_title VARCHAR(80) NULL AFTER staff_access_level");
  for (const [id, name, email, role, staffAccessLevel] of accounts) {
    await connection.execute(
      `INSERT INTO users (id, tenant_id, name, email, password_hash, phone, gender, role, staff_access_level, email_verified_at)
       VALUES (?, ?, ?, ?, ?, '+5511999999999', 'OUTRO', ?, ?, NOW())
       ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), role = VALUES(role), staff_access_level = VALUES(staff_access_level), email_verified_at = NOW()`,
      [id, tenantId, name, email, passwordHash, role, staffAccessLevel]
    );
  }
  for (const [id, name, description, price, duration] of services) {
    await connection.execute(
      `INSERT INTO services (id, tenant_id, name, description, price, duration_minutes, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), price = VALUES(price), duration_minutes = VALUES(duration_minutes), active = 1`,
      [id, tenantId, name, description, price, duration]
    );
  }
  await connection.execute(
    `INSERT INTO professionals (id, tenant_id, user_id, bio, active)
     VALUES (?, ?, ?, 'Cortes, cor e cuidado capilar.', 1)
     ON DUPLICATE KEY UPDATE bio = VALUES(bio), active = 1`,
    [professionalId, tenantId, accounts[2][0]]
  );
  for (const service of services) await connection.execute('INSERT IGNORE INTO professional_services (professional_id, service_id) VALUES (?, ?)', [professionalId, service[0]]);
  for (const day of [1, 2, 3, 4, 5, 6]) await connection.execute('INSERT IGNORE INTO working_hours (professional_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)', [professionalId, day, '09:00:00', '18:00:00']);
  await connection.commit();
  console.log('Contas de equipe criadas ou atualizadas.');
} catch (error) {
  await connection.rollback();
  console.error(error);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
