const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    let token;

    console.log('🔐 Verificando autenticação...');
    console.log('📨 Headers authorization:', req.headers.authorization);

    // Verificar se o token está no header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      console.log('✅ Token encontrado no header');
    }

    // Verificar se o token existe
    if (!token) {
      console.log('❌ Token não fornecido');
      return res.status(401).json({ 
        success: false,
        message: 'Acesso não autorizado. Token não fornecido.' 
      });
    }

    console.log('🔍 Verificando token JWT...');

    // Verificar e decodificar o token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token válido. User ID:', decoded.userId);
    
    // Buscar usuário pelo ID do token
    const user = await User.findById(decoded.userId).select('-password');
    
    // Verificar se o usuário existe
    if (!user) {
      console.log('❌ Usuário não encontrado no banco');
      return res.status(401).json({ 
        success: false,
        message: 'Usuário não encontrado. Token inválido.' 
      });
    }

    // Adicionar usuário à requisição
    req.user = user;
    console.log('✅ Usuário autenticado:', user.name);

    // Continuar para a próxima middleware/rota
    next();
    
  } catch (error) {
    console.error('❌ Erro na autenticação:', error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false,
        message: 'Token inválido.' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        message: 'Token expirado.' 
      });
    }
    
    res.status(401).json({ 
      success: false,
      message: 'Falha na autenticação.' 
    });
  }
};

module.exports = { protect };
