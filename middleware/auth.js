const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const router = express.Router();

// 🎯 REGISTRO DE NOVO USUÁRIO
router.post('/register', async (req, res) => {
  try {
    console.log('📝 Tentando registrar usuário:', req.body);

    const { name, email, password } = req.body;

    // Validar campos obrigatórios
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nome, email e senha são obrigatórios'
      });
    }

    // Verificar se usuário já existe
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'Usuário já existe com este email'
      });
    }

    // Criar hash da senha
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Criar usuário
    const user = await User.create({
      name,
      email,
      password: hashedPassword
    });

    // Gerar token JWT
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log('✅ Usuário registrado com sucesso:', user.email);

    res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso',
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('❌ ERRO NO REGISTRO:', error);
    res.status(500).json({
      success: false,
      message: 'Erro no servidor ao criar usuário'
    });
  }
});

// 🔐 LOGIN DO USUÁRIO
router.post('/login', async (req, res) => {
  try {
    console.log('🔑 Tentando login:', req.body.email);

    const { email, password } = req.body;

    // Validar campos
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email e senha são obrigatórios'
      });
    }

    // Verificar se usuário existe
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Email ou senha inválidos'
      });
    }

    // Verificar senha
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Email ou senha inválidos'
      });
    }

    // Gerar token JWT
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log('✅ Login realizado com sucesso:', user.email);

    res.json({
      success: true,
      message: 'Login realizado com sucesso',
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('❌ ERRO NO LOGIN:', error);
    res.status(500).json({
      success: false,
      message: 'Erro no servidor ao fazer login'
    });
  }
});

// 👤 OBTER DADOS DO USUÁRIO LOGADO (ROTA NOVA)
router.get('/me', protect, async (req, res) => {
  try {
    console.log('📋 Buscando dados do usuário:', req.user._id);
    
    // Retornar dados do usuário (sem a senha)
    const userData = {
      _id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      createdAt: req.user.createdAt
    };

    res.json({
      success: true,
      user: userData
    });

  } catch (error) {
    console.error('❌ Erro ao buscar dados do usuário:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar dados do usuário'
    });
  }
});

// 🧪 ROTA DE TESTE (protegida)
router.get('/test', protect, (req, res) => {
  res.json({
    success: true,
    message: 'Rota de autenticação funcionando!',
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email
    }
  });
});

// 🌐 ROTA PÚBLICA DE TESTE
router.get('/status', (req, res) => {
  res.json({
    success: true,
    message: 'API de autenticação online!',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
