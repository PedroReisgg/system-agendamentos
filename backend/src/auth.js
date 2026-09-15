import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Token ausente.' });
  try { req.auth = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Token inválido ou expirado.' }); }
}
export const allow = (...roles) => (req, res, next) => roles.includes(req.auth.role) ? next() : res.status(403).json({ error: 'Sem permissão.' });
export const requireStaff = (req, res, next) => ['admin', 'cashier', 'professional'].includes(req.auth.role) ? next() : res.status(403).json({ error: 'Acesso exclusivo da equipe.' });
export const requireManager = (req, res, next) => req.auth.role === 'admin' || req.auth.role === 'cashier' || req.auth.staffAccessLevel === 'manager' ? next() : res.status(403).json({ error: 'Apenas gestores podem alterar dados.' });
export const sign = (user) => jwt.sign({ sub: user.id, tenantId: user.tenant_id, role: user.role, staffAccessLevel: user.staff_access_level, name: user.name }, process.env.JWT_SECRET, { expiresIn: '8h' });
