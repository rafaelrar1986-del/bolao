const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

// ======================
// MIDDLEWARES COM BODY-PARSER
// ======================
app.use(cors());

// 🔥 USAR BODY-PARSER EM VEZ DO EXPRESS.JSON()
app.use(bodyParser.json({ 
  limit: '10mb',
  type: 'application/json'
}));

app.use(bodyParser.urlencoded({ 
  extended: true,
  limit: '10mb'
}));

// Debug middleware
app.use((req, res, next) => {
  console.log('='.repeat(50));
  console.log(`📨 ${req.method} ${req.url}`);
  console.log('📋 Content-Type:', req.headers['content-type']);
  console.log('📦 Body RAW TYPE:', typeof req.body);
  console.log('📦 Body VALUE:', req.body);
  console.log('📦 Body KEYS:', Object.keys(req.body || {}));
  console.log('='.repeat(50));
  next();
});

// ======================
// BANCO DE DADOS - CONEXÃO CORRIGIDA
// ======================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bolao-copa-2026', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000, // 30 segundos
  socketTimeoutMS: 45000, // 45 segundos
})
.then(() => console.log('✅ MongoDB conectado!'))
.catch(err => {
  console.log('❌ ERRO MongoDB:');
  console.log('- Verifique MONGODB_URI nas variáveis de ambiente');
  console.log('- String de conexão:', process.env.MONGODB_URI ? '✅ Configurada' : '❌ Não configurada');
  console.log('- Erro detalhado:', err.message);
});

// ======================
// ROTAS
// ======================

// Rotas simples
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Backend funcionando!',
    database: mongoose.connection.readyState === 1 ? '✅ Conectado' : '❌ Desconectado',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK',
    database: mongoose.connection.readyState === 1 ? 'Conectado' : 'Desconectado',
    mongodb_state: mongoose.connection.readyState
  });
});

// Rotas da aplicação
const authRoutes = require('./routes/auth');
const matchesRoutes = require('./routes/matches');

app.use('/api/auth', authRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/bets', require('./routes/bets')); 

// Rota 404
app.use((req, res) => {
  res.status(404).json({ 
    message: 'Rota não encontrada: ' + req.url
  });
});

// ======================
// INICIAR SERVIDOR
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('='.repeat(40));
  console.log(`🎯 Servidor rodando: http://localhost:${PORT}`);
  console.log('📊 MongoDB State:', mongoose.connection.readyState);
  console.log('🌐 Ambiente:', process.env.NODE_ENV || 'development');
  console.log('='.repeat(40));
});
