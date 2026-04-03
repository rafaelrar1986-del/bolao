const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const cron = require('node-cron');
const updateMatches = require('./services/matchUpdater');

const app = express();

// ======================
// CONFIGURAÇÃO DE VARIÁVEIS DE AMBIENTE
// ======================
const REQUIRED_ENV_VARS = ['MONGODB_URI'];
const missingVars = REQUIRED_ENV_VARS.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Variáveis de ambiente faltando:', missingVars);
  console.error('⚠️  Configure no arquivo .env ou nas variáveis de ambiente do servidor');
}

// ======================
// CONFIGURAÇÃO CORS CORRIGIDA - FUNCIONANDO PARA VERCEL
// ======================
const allowedOrigins = [
  'https://bolao-d2zh.vercel.app',
  'https://bolao-gamma.vercel.app',
  /\.vercel\.app$/, // todos os subdomínios vercel
  /\.netlify\.app$/, // todos os subdomínios netlify
  'https://bolao5.pages.dev',   // ✅ ADICIONE ESTA LINHA
  /\.pages\.dev$/,   
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8000',
  'http://localhost:8080'
];

const corsOptions = {
  origin(origin, callback) {
    // Permitir requests sem Origin (ex.: healthchecks, curl, Postman)
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.some(allowed =>
      typeof allowed === 'string' ? origin === allowed : allowed.test(origin)
    );
    return isAllowed ? callback(null, true) : callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  // Deixe o CORS refletir automaticamente os headers do preflight
  optionsSuccessStatus: 204,
  maxAge: 86400 // cache do preflight por 24h
};

// Aplique CORS globalmente e trate preflights automaticamente
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ======================
// PARSERS
// ======================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Debug middleware (opcional - pode remover em produção)
app.use((req, res, next) => {
  console.log('='.repeat(50));
  console.log(`📨 ${req.method} ${req.url}`);
  console.log('📋 Origin:', req.headers.origin);
  console.log('🔑 Authorization:', req.headers.authorization ? 'Presente' : 'Ausente');
  console.log('📦 Content-Type:', req.headers['content-type']);
  console.log('📦 Body KEYS:', Object.keys(req.body || {}));
  if (Object.keys(req.body || {}).length > 0) {
    console.log('📦 Body SAMPLE:', JSON.stringify(req.body).substring(0, 200) + '...');
  }
  console.log('='.repeat(50));
  next();
});

// ======================
// BANCO DE DADOS - CONEXÃO
// ======================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bolao-copa-2026';

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000, // 30 segundos
    socketTimeoutMS: 45000, // 45 segundos
    retryWrites: true,
    w: 'majority'
  })
  .then(() => {
    console.log('✅ MongoDB conectado com sucesso!');
    console.log('📊 Database:', mongoose.connection.name);
    console.log('🔗 Host:', mongoose.connection.host);
  })
  .catch(err => {
    console.error('❌ ERRO na conexão com MongoDB:');
    console.error('- Verifique MONGODB_URI nas variáveis de ambiente');
    console.error('- String de conexão:', MONGODB_URI.substring(0, 20) + '...');
    console.error('- Erro detalhado:', err.message);

    // Em desenvolvimento, encerra; em produção apenas loga
    if (process.env.NODE_ENV === 'development') {
      process.exit(1);
    }
  });

// Eventos de conexão do MongoDB
mongoose.connection.on('error', err => {
  console.error('❌ Erro na conexão MongoDB:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️  MongoDB desconectado');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconectado');
});

// ======================
// ROTAS - IMPORTAÇÕES
// ======================
const authRoutes = require('./routes/auth');
const matchesRoutes = require('./routes/matches');
const betsRoutes = require('./routes/bets');
const duelRoutes = require('./routes/duels');
const pointsRoutes = require('./routes/points');
const usersRoutes = require('./routes/users');
const newsRoutes = require('./routes/news');
const settingsRoutes = require('./routes/settings');
const pointsHistoryRoutes = require('./routes/pointsHistory');
const roundHistoryRoutes = require('./routes/roundHistory');
// Rota que contém a gestão de usuários, aprovação de pagamentos e broadcast
const adminRoutes = require('./routes/admin'); 

// ======================
// ROTAS - USO (DEFINIÇÃO DE ENDPOINTS)
// ======================

app.get('/', (req, res) => {
  res.json({
    message: '🚀 Backend do Bolão da Copa funcionando!',
    version: '1.0.0',
    database: mongoose.connection.readyState === 1 ? '✅ Conectado' : '❌ Desconectado',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    cors: {
      allowed_origins: [
        'https://bolao-d2zh.vercel.app',
        'https://bolao-gamma.vercel.app',
        '*.vercel.app',
        '*.netlify.app',
        'https://bolao5.pages.dev',   // ✅ ADICIONA AQUI TAMBÉM
        '*.pages.dev',                // ✅ OPCIONAL: PERMITIR QUALQUER SUBDOMÍNIO pages.dev
        'localhost:3000',
        'localhost:5173'
      ]
    }
  });
});

app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy';
  const statusCode = dbStatus === 'healthy' ? 200 : 503;

  res.status(statusCode).json({
    status: dbStatus === 'healthy' ? 'OK' : 'ERROR',
    database: dbStatus,
    mongodb_state: mongoose.connection.readyState,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    origin: req.headers.origin || 'No origin header'
  });
});

// ✅ ROTA TEMPORÁRIA PARA TESTE DO BETS
app.get('/api/bets', (req, res) => {
  res.json({
    success: true,
    message: '🏆 API de Palpites - Use as rotas específicas',
    endpoints: {
      'GET /api/bets/my-bets': 'Buscar meus palpites',
      'POST /api/bets/save': 'Salvar palpites',
      'GET /api/bets/status': 'Verificar status',
      'GET /api/bets/test': 'Rota de teste'
    },
    timestamp: new Date().toISOString(),
    origin: req.headers.origin || 'No origin header'
  });
});

// Rotas de funcionalidades de usuário
app.use('/api/news', newsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/duels', duelRoutes);
app.use('/api/bets', betsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/points', pointsRoutes);
app.use('/api/points-history', pointsHistoryRoutes);

// ✅ GESTÃO ADMINISTRATIVA (CORRIGIDO)
// Agora o endpoint /api/admin/users e /api/admin/approve-user funcionarão
app.use('/api/admin', adminRoutes); 

// ✅ HISTÓRICO DE RODADAS (MOVIDO PARA ENDPOINT PRÓPRIO)
app.use('/api/round-history', roundHistoryRoutes);

// ✅ COMUNICAÇÃO (OPCIONAL - BROADCAST TAMBÉM DISPONÍVEL VIA /api/admin)
// Como o adminRoutes já está em /api/admin, o broadcast pode ser acessado em /api/admin/send
// Se preferir manter um endpoint separado para e-mails, mantenha a linha abaixo:
app.use('/api/email-broadcast', adminRoutes);

// ======================
// MIDDLEWARES DE ERRO - NOVOS
// ======================

// Rota 404 - Para rotas não encontradas (MOVIDO PARA DEPOIS DAS ROTAS REAIS)
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Rota não encontrada: ${req.originalUrl}`,
    method: req.method,
    availableEndpoints: {
      '/': 'Página inicial',
      '/api/health': 'Health check',
      '/api/auth/*': 'Rotas de autenticação',
      '/api/matches/*': 'Rotas de partidas',
      '/api/bets/*': 'Rotas de palpites'
    },
    origin: req.headers.origin || 'No origin header'
  });
});

// ✅ Middleware de erro global
app.use((error, req, res, next) => {
  console.error('💥 Erro não tratado:', error);

  // Erro de CORS
  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'Acesso bloqueado por política CORS',
      origin: req.headers.origin,
      allowed_origins: [
        'https://bolao-d2zh.vercel.app',
        'https://bolao-gamma.vercel.app',
        '*.vercel.app',
        '*.netlify.app',
        'https://bolao5.pages.dev',   // ✅ ADICIONA AQUI TAMBÉM
        '*.pages.dev'                 // ✅ OPCIONAL: PERMITIR QUALQUER SUBDOMÍNIO pages.dev
      ]
    });
  }

  // Erro de validação do Mongoose
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Erro de validação',
      errors: Object.values(error.errors).map(err => err.message)
    });
  }

  // Erro de duplicata do MongoDB
  if (error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Dados duplicados',
      field: Object.keys(error.keyPattern)[0]
    });
  }

  // Erro de JWT
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Token inválido'
    });
  }

  // Erro genérico
  res.status(error.status || 500).json({
    success: false,
    message: 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'production' ? {} : error.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
  });
});

// ======================
// MANIPULADOR DE SINAIS PARA DESLIGAMENTO GRACIOSO
// ======================
process.on('SIGINT', async () => {
  console.log('🛑 Recebido SIGINT. Desligando servidor graciosamente...');
  await mongoose.connection.close();
  console.log('✅ MongoDB desconectado');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Recebido SIGTERM. Desligando servidor graciosamente...');
  await mongoose.connection.close();
  console.log('✅ MongoDB desconectado');
  process.exit(0);
});

// ======================
// INICIAR SERVIDOR
// ======================
const PORT = process.env.PORT || 5000;
// ======================
// CRON AUTOMÁTICO
// ======================
cron.schedule('*/2 * * * *', () => {
  console.log('🔄 Atualizando jogos automaticamente...');
  updateMatches();
});
const server = app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🎯 Servidor rodando: http://localhost:${PORT}`);
  console.log(`📊 MongoDB State: ${mongoose.connection.readyState === 1 ? '✅ Conectado' : '❌ Desconectado'}`);
  console.log(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🕒 Iniciado em: ${new Date().toLocaleString('pt-BR')}`);
   console.log('🌍 Domínios permitidos:');
  console.log('   ✅ https://bolao-d2zh.vercel.app');
  console.log('   ✅ https://bolao-gamma.vercel.app');
  console.log('   ✅ https://bolao5.pages.dev');         // ✅ NOVO
  console.log('   ✅ *.vercel.app');
  console.log('   ✅ *.netlify.app');
  console.log('   ✅ *.pages.dev');                      // ✅ OPCIONAL
  console.log('   ✅ localhost:3000, 5173, 8000, 8080');

  console.log('='.repeat(50));
 const mapApiIds = require('./services/mapApiIdsBSD');
mapApiIds();
});

// Manipulador de erro do servidor
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Porta ${PORT} já está em uso!`);
  } else {
    console.error('❌ Erro no servidor:', error);
  }
  process.exit(1);
});

module.exports = app;
