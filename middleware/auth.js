const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    // 🔥 VERIFICAÇÃO CRÍTICA: JWT_SECRET configurado
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET não configurado nas variáveis de ambiente');
      return res.status(500).json({ 
        success: false,
        message: 'Erro de configuração do servidor' 
      });
    }

    let token;

    console.log('🔐 Middleware protect - Iniciando verificação...');
    console.log('📨 Headers authorization:', req.headers.authorization ? 'Presente' : 'Ausente');

    // Verificar se o token está no header Authorization
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      console.log('✅ Token extraído do header Authorization');
    } 
    // Verificar se o token está no header personalizado (fallback)
    else if (req.headers['x-auth-token']) {
      token = req.headers['x-auth-token'];
      console.log('✅ Token extraído do header x-auth-token');
    }
    // Verificar token na query string (apenas para desenvolvimento)
    else if (req.query.token && process.env.NODE_ENV === 'development') {
      token = req.query.token;
      console.log('⚠️  Token extraído da query string (apenas desenvolvimento)');
    }

    // Verificar se o token existe
    if (!token) {
      console.log('❌ Nenhum token encontrado nos headers');
      return res.status(401).json({ 
        success: false,
        message: 'Acesso não autorizado. Token de autenticação não fornecido.',
        details: {
          expectedHeaders: [
            'Authorization: Bearer <token>',
            'x-auth-token: <token>'
          ],
          development: process.env.NODE_ENV === 'development' ? 'Pode usar ?token= na query string' : undefined
        }
      });
    }

    console.log('🔍 Verificando token JWT...');
    console.log('📝 Token (primeiros 20 chars):', token.substring(0, 20) + '...');

    // Verificar e decodificar o token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token JWT válido. Payload:', decoded);
    
    // Buscar usuário pelo ID do token
    const user = await User.findById(decoded.userId).select('-password');
    
    // Verificar se o usuário existe
    if (!user) {
      console.log('❌ Usuário não encontrado no banco para o ID:', decoded.userId);
      return res.status(401).json({ 
        success: false,
        message: 'Usuário não encontrado. Token inválido.' 
      });
    }

    // Verificar se o usuário está ativo (caso adicione campo 'active' no futuro)
    if (user.active === false) {
      console.log('❌ Usuário inativo:', user.email);
      return res.status(401).json({ 
        success: false,
        message: 'Conta desativada. Entre em contato com o administrador.' 
      });
    }

    // Adicionar usuário à requisição
    req.user = user;
    console.log('✅ Usuário autenticado com sucesso:', {
      id: user._id,
      name: user.name,
      email: user.email
    });

    // Continuar para a próxima middleware/rota
    next();
    
  } catch (error) {
    console.error('❌ Erro na autenticação:', {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    // Erros específicos do JWT
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false,
        message: 'Token inválido.',
        error: 'Token malformado ou assinatura inválida'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        message: 'Token expirado.',
        error: 'Faça login novamente'
      });
    }

    // Erro de cast do MongoDB (ID inválido)
    if (error.name === 'CastError') {
      return res.status(401).json({ 
        success: false,
        message: 'Token contém ID de usuário inválido.'
      });
    }

    // Erro de banco de dados
    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
      console.error('💥 Erro de banco de dados durante autenticação:', error);
      return res.status(503).json({ 
        success: false,
        message: 'Serviço temporariamente indisponível. Tente novamente.'
      });
    }
    
    // Erro genérico
    res.status(401).json({ 
      success: false,
      message: 'Falha na autenticação.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ======================
// MIDDLEWARE DE ADMIN (OPCIONAL - PARA FUTURAS FUNCIONALIDADES)
// ======================
const admin = async (req, res, next) => {
  try {
    // Primeiro verifica se está autenticado
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Acesso não autorizado. Faça login primeiro.'
      });
    }

    // Verifica se é admin
    if (!req.user.isAdmin) {
      console.log('❌ Acesso negado - usuário não é admin:', req.user.email);
      return res.status(403).json({
        success: false,
        message: 'Acesso negado. Permissão de administrador necessária.'
      });
    }

    console.log('✅ Acesso admin concedido para:', req.user.email);
    next();
    
  } catch (error) {
    console.error('❌ Erro no middleware admin:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao verificar permissões'
    });
  }
};

// ======================
// MIDDLEWARE DE PERMISSÕES (OPCIONAL - PARA FUTURAS FUNCIONALIDADES)
// ======================
const requirePermission = (permission) => {
  return (req, res, next) => {
    // Implementação futura para permissões específicas
    console.log(`🔐 Verificando permissão: ${permission} para`, req.user.email);
    next();
  };
};

module.exports = { 
  protect, 
  admin,
  requirePermission 
};
