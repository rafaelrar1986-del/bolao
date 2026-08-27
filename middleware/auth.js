// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const getTokenFromHeaders = (req) => {
  const auth = req.headers.authorization || '';
  if (auth && auth.toLowerCase().startsWith('bearer')) {
    const parts = auth.split(' ');
    if (parts.length >= 2) return parts.slice(1).join(' ').trim();
  }
  if (req.headers['x-auth-token']) return String(req.headers['x-auth-token']).trim();
  if (req.headers['x-access-token']) return String(req.headers['x-access-token']).trim();
  return null;
};

const decodeUserId = (decoded) =>
  decoded?.userId || decoded?.id || decoded?._id || null;

const protect = async (req, res, next) => {
  try {
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET não configurado');
      return res.status(500).json({
        success: false,
        message: 'Erro de configuração do servidor',
      });
    }

    let token = getTokenFromHeaders(req);

    if (!token && req.query.token && process.env.NODE_ENV === 'development') {
      token = String(req.query.token).trim();
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Acesso não autorizado. Forneça o token JWT.',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token expirado.' });
      }
      return res.status(401).json({ success: false, message: 'Token inválido.' });
    }

    const userId = decodeUserId(decoded);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Token sem identificador.' });
    }

    // Buscamos o usuário garantindo que isAdmin e hasPaid venham do banco
    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuário não encontrado.' });
    }

    // Removi a checagem de user.active pois o campo não existe no seu Model User.js
    // Se quiser usar, adicione "active: { type: Boolean, default: true }" no Model.

    req.user = user; 
    return next();
  } catch (error) {
    console.error('❌ Erro no protect:', error);
    return res.status(401).json({ success: false, message: 'Falha na autenticação.' });
  }
};

const checkPaid = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Autenticação necessária.' });
  }

  if (req.user.isAdmin || req.user.hasPaid) {
    return next();
  }

  return res.status(402).json({
    success: false,
    message: 'Acesso bloqueado: Pagamento da cota pendente.',
    requiresPayment: true
  });
};

const admin = (req, res, next) => {
  // LOG DE DEBUG: Se o Toast de erro aparecer, cheque o terminal do Render/VSCode
  // Ele vai te dizer exatamente o que está acontecendo com o seu usuário.
  if (!req.user) {
    console.log('⚠️ Tentativa de acesso Admin sem req.user');
    return res.status(401).json({ success: false, message: 'Usuário não identificado.' });
  }

  if (!req.user.isAdmin) {
    console.log(`🚫 Acesso NEGADO para: ${req.user.email} (Não é Admin)`);
    return res.status(403).json({ success: false, message: 'Acesso negado. Requer Admin.' });
  }

  console.log(`✅ Acesso Admin AUTORIZADO: ${req.user.email}`);
  return next();
};

const requirePermission = (permission) => {
  return (req, res, next) => next();
};

module.exports = {
  protect,
  admin,
  checkPaid, 
  requirePermission,
};
