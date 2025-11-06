// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const getTokenFromHeaders = (req) => {
  // Node normaliza headers para minúsculo
  const auth = req.headers.authorization || '';
  if (auth && auth.toLowerCase().startsWith('bearer')) {
    // "Bearer <token>" (com eventuais espaços extras)
    const parts = auth.split(' ');
    if (parts.length >= 2) return parts.slice(1).join(' ').trim();
  }
  // Fallbacks comuns
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

    // Em dev, permite ?token= na URL
    if (!token && req.query.token && process.env.NODE_ENV === 'development') {
      token = String(req.query.token).trim();
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Acesso não autorizado. Forneça o token JWT.',
        details: {
          expected: 'Authorization: Bearer <token>',
          fallbacks: ['x-auth-token', 'x-access-token'],
        },
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expirado. Faça login novamente.',
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Token inválido.',
      });
    }

    const userId = decodeUserId(decoded);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Token sem identificador de usuário.',
      });
    }

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Usuário não encontrado.',
      });
    }

    if (user.active === false) {
      return res.status(401).json({
        success: false,
        message: 'Conta desativada. Contate o administrador.',
      });
    }

    req.user = user; // inclui isAdmin, email, name etc.
    return next();
  } catch (error) {
    console.error('❌ Erro no protect:', error);
    return res.status(401).json({
      success: false,
      message: 'Falha na autenticação.',
    });
  }
};

// Middleware de admin simples: requer req.user.isAdmin === true
const admin = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Acesso não autorizado. Faça login primeiro.',
      });
    }

    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Acesso negado. Permissão de administrador necessária.',
      });
    }

    return next();
  } catch (error) {
    console.error('❌ Erro no middleware admin:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar permissões',
    });
  }
};

// Stub para futuras permissões granulares
const requirePermission = (permission) => {
  return (req, res, next) => {
    // Ex.: checar req.user.permissions.includes(permission)
    return next();
  };
};

module.exports = {
  protect,
  admin,
  requirePermission,
};
