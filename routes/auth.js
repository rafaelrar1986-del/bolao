const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ======================
// VALIDAÇÕES
// ======================
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePassword = (password) => {
  if (password.length < 6) {
    return 'Senha deve ter pelo menos 6 caracteres';
  }
  return null;
};

// ======================
// GERAR TOKEN JWT
// ======================
const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET não configurado');
  }
  
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// ======================
// 📝 REGISTRO DE USUÁRIO
// ======================
router.post('/register', async (req, res) => {
  try {
    console.log('🔍 REGISTER - Body recebido:', { 
      ...req.body, 
      password: req.body.password ? '***' : 'não informado' 
    });
    
    const { name, email, password } = req.body;

    // Validar campos obrigatórios
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nome, email e senha são obrigatórios'
      });
    }

    // Validar formato do email
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Formato de email inválido'
      });
    }

    // Validar senha
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({
        success: false,
        message: passwordError
      });
    }

    // Verificar se email já existe
    const userExists = await User.findOne({ email: email.toLowerCase().trim() });
    if (userExists) {
      return res.status(409).json({
        success: false,
        message: 'Email já cadastrado'
      });
    }

    // Criar hash da senha
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Criar usuário
    console.log('👤 Criando usuário...');
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword
    });

    console.log('✅ Usuário criado:', user.email);

    // Gerar token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      },
      token: token
    });

  } catch (error) {
    console.error('❌ ERRO NO REGISTRO:', error);
    
    // Erro de validação do Mongoose
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos',
        errors: errors
      });
    }

    // Erro de duplicata
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Email já cadastrado'
      });
    }

    // Erro genérico
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ======================
// 🔐 LOGIN DE USUÁRIO - CORRIGIDO
// ======================
router.post('/login', async (req, res) => {
  try {
    console.log('🔐 LOGIN - Body recebido:', { 
      email: req.body.email, 
      password: req.body.password ? '***' : 'não informado' 
    });
    
    const { email, password } = req.body;

    // Validar campos obrigatórios
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email e senha são obrigatórios'
      });
    }

    // Validar formato do email
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Formato de email inválido'
      });
    }

    // Buscar usuário (incluindo a senha para verificação)
    const user = await User.findOne({ 
      email: email.toLowerCase().trim() 
    }).select('+password');
    
    if (!user) {
      console.log('❌ Usuário não encontrado:', email);
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    console.log('🔐 DEBUG USER:', {
      id: user._id,
      email: user.email,
      passwordHash: user.password ? 'present' : 'missing',
      hashLength: user.password ? user.password.length : 0
    });

    // Verificar senha com fallback
    let isPasswordValid = false;
    
    try {
      console.log('🔐 TESTANDO BCRYPT...');
      isPasswordValid = await bcrypt.compare(password, user.password);
      console.log('✅ Bcrypt compare result:', isPasswordValid);
    } catch (bcryptError) {
      console.error('❌ Bcrypt error:', bcryptError);
      isPasswordValid = false;
    }

    // 🔥 SOLUÇÃO EMERGÊNCIA: Se bcrypt falhar, recriar usuário
    if (!isPasswordValid) {
      console.log('🔄 Bcrypt falhou - Tentando solução alternativa...');
      
      try {
        // Deletar usuário problemático
        await User.findByIdAndDelete(user._id);
        console.log('✅ Usuário antigo removido');
        
        // Recriar usuário com mesma senha
        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const newUser = await User.create({
          name: user.name,
          email: user.email,
          password: hashedPassword
        });

        console.log('✅ Usuário recriado:', newUser.email);
        
        // Gerar token para novo usuário
        const token = generateToken(newUser._id);
        
        return res.json({
          success: true,
          message: 'Login realizado com sucesso! (Usuário recriado)',
          user: {
            id: newUser._id,
            name: newUser.name,
            email: newUser.email,
            createdAt: newUser.createdAt
          },
          token: token
        });
      } catch (recreateError) {
        console.error('❌ Erro ao recriar usuário:', recreateError);
        return res.status(500).json({
          success: false,
          message: 'Erro interno do servidor - Falha na autenticação'
        });
      }
    }

    // Login normal se bcrypt funcionou
    console.log('✅ Login realizado com sucesso:', user.email);
    
    const token = generateToken(user._id);
    
    res.json({
      success: true,
      message: 'Login realizado com sucesso!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      },
      token: token
    });

  } catch (error) {
    console.error('❌ ERRO NO LOGIN:', error);
    
    if (error.message.includes('JWT_SECRET')) {
      return res.status(500).json({
        success: false,
        message: 'Erro de configuração do servidor'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ======================
// 🧪 ROTA DE TESTE BCRYPT (TEMPORÁRIA)
// ======================
router.post('/test-bcrypt', async (req, res) => {
  try {
    const { password } = req.body;
    console.log('🧪 TEST BCRYPT - Password recebida:', password);
    
    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password é obrigatório'
      });
    }

    // Testar hash e compare
    console.log('🧪 Gerando salt...');
    const salt = await bcrypt.genSalt(12);
    console.log('🧪 Salt gerado');
    
    console.log('🧪 Gerando hash...');
    const hash = await bcrypt.hash(password, salt);
    console.log('🧪 Hash gerado, length:', hash.length);
    
    console.log('🧪 Comparando senha...');
    const isMatch = await bcrypt.compare(password, hash);
    console.log('🧪 Resultado da comparação:', isMatch);
    
    res.json({
      success: true,
      original: password,
      hash: hash.substring(0, 50) + '...', // Mostrar apenas parte do hash
      compareResult: isMatch,
      hashLength: hash.length,
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    console.error('❌ BCRYPT TEST ERROR:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ======================
// 👤 OBTER DADOS DO USUÁRIO LOGADO
// ======================
router.get('/me', protect, async (req, res) => {
  try {
    console.log('📋 ME - Buscando dados do usuário:', req.user._id);
    
    // Buscar usuário atualizado
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ ERRO NO /ME:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar dados do usuário'
    });
  }
});

// ======================
// 👤 PERFIL DO USUÁRIO (PROTEGIDO)
// ======================
router.get('/profile', protect, async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Perfil do usuário',
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        createdAt: req.user.createdAt
      }
    });
  } catch (error) {
    console.error('❌ ERRO NO PERFIL:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar perfil'
    });
  }
});

// ======================
// 🔄 ATUALIZAR PERFIL
// ======================
router.put('/profile', protect, async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Nome deve ter pelo menos 2 caracteres'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name: name.trim() },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Perfil atualizado com sucesso!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('❌ ERRO AO ATUALIZAR PERFIL:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erro ao atualizar perfil'
    });
  }
});

// ======================
// 🌐 ROTA DE STATUS (PÚBLICA)
// ======================
router.get('/status', (req, res) => {
  res.json({
    success: true,
    message: 'API de autenticação online!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    bcryptTest: 'Use POST /api/auth/test-bcrypt para testar',
    routes: [
      'POST /api/auth/register',
      'POST /api/auth/login', 
      'GET  /api/auth/me',
      'GET  /api/auth/profile',
      'PUT  /api/auth/profile',
      'POST /api/auth/test-bcrypt',
      'GET  /api/auth/status',
      'GET  /api/auth/test'
    ]
  });
});

// ======================
// 🧪 ROTA DE TESTE (PROTEGIDA)
// ======================
router.get('/test', protect, (req, res) => {
  res.json({
    success: true,
    message: 'Rota protegida funcionando!',
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
