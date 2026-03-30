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

    // 🔥 Aqui o req.user já terá o campo hasPaid vindo do banco
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuário não encontrado.' });
    }

    if (user.active === false) {
      return res.status(401).json({ success: false, message: 'Conta desativada.' });
    }

    req.user = user; 
    return next();
  } catch (error) {
    console.error('❌ Erro no protect:', error);
    return res.status(401).json({ success: false, message: 'Falha na autenticação.' });
  }
};

/**
 * 🔥 NOVO: Middleware de Verificação de Pagamento
 * Bloqueia o acesso se hasPaid for false, exceto para Admins.
 */
const checkPaid = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Autenticação necessária.' });
  }

  // Admins sempre têm acesso livre para gerenciar o bolão
  if (req.user.isAdmin || req.user.hasPaid) {
    return next();
  }

  // Retornamos 402 (Payment Required) para o frontend saber que deve mostrar o PIX
  return res.status(402).json({
    success: false,
    message: 'Acesso bloqueado: Pagamento da cota pendente.',
    requiresPayment: true
  });
};

const admin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Acesso negado. Requer Admin.' });
  }
  return next();
};

const requirePermission = (permission) => {
  return (req, res, next) => next();
};

module.exports = {
  protect,
  admin,
  checkPaid, // 🚀 Exportado para uso nas rotas
  requirePermission,
};
