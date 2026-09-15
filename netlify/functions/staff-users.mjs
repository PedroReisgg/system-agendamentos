import { createClient } from '@supabase/supabase-js';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body)
});

export default async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'Método não permitido.' });

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json(500, { error: 'Função administrativa não configurada no Netlify.' });

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Sessão não encontrada.' });

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json(401, { error: 'Sessão inválida.' });

  const { data: actor } = await admin
    .from('users')
    .select('tenant_id, role, staff_access_level')
    .eq('auth_user_id', authData.user.id)
    .single();
  const canManage = actor && (actor.role === 'admin' || actor.role === 'cashier' || actor.staff_access_level === 'manager');
  if (!canManage) return json(403, { error: 'Sua conta não possui permissão para cadastrar funcionários.' });

  let payload;
  try { payload = await request.json(); }
  catch { return json(400, { error: 'Dados inválidos.' }); }

  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const phone = String(payload.phone || '').replace(/\D/g, '');
  const role = ['professional', 'cashier', 'admin'].includes(payload.role) ? payload.role : 'professional';
  const staffAccessLevel = payload.staffAccessLevel === 'manager' ? 'manager' : 'viewer';
  const jobTitle = String(payload.jobTitle || 'Funcionário').trim();
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 3 || !phone) {
    return json(422, { error: 'Preencha nome, e-mail, senha de ao menos 3 caracteres e telefone.' });
  }

  const { data: tenant } = await admin.from('tenants').select('slug').eq('id', actor.tenant_id).single();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone: `+${phone}`, gender: 'OUTRO', favorite_services: [], tenant_slug: tenant?.slug || 'casa-ambar' }
  });
  if (createError || !created.user) return json(422, { error: createError?.message || 'Não foi possível criar a conta.' });

  const { data: profile, error: profileError } = await admin
    .from('users')
    .update({ name, email, phone: `+${phone}`, role, staff_access_level: staffAccessLevel, job_title: jobTitle })
    .eq('auth_user_id', created.user.id)
    .select('id')
    .single();
  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json(500, { error: 'A conta foi criada, mas o perfil não pôde ser configurado.' });
  }

  if (role === 'professional') {
    await admin.from('professionals').insert({ tenant_id: actor.tenant_id, user_id: profile.id, bio: `${jobTitle} da equipe.` });
  }
  return json(201, { id: profile.id, message: 'Funcionário cadastrado com sucesso.' });
};
