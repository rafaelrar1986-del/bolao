const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const cron = require('node-cron');
const updateMatches = require('./services/matchUpdater');

// ======================
// IMPORTAÇÃO DE ROTAS
// ======================
const groupRoutes = require('./routes/groupRoutes'); 
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
const adminRoutes = require('./routes/admin'); 

const app = express();

// ======================
// CONFIGURAÇÃO DE VARIÁVEIS DE AMBIENTE
// ======================
const REQUIRED_ENV_VARS = ['MONGODB_URI'];
const missingVars = REQUIRED_ENV_VARS.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Variáveis de ambiente faltando:', missingVars);
  console.error('⚠️ Configure no arquivo .env ou nas variáveis de ambiente do servidor');
}

// ======================
// CONFIGURAÇÃO CORS - VERSÃO FINAL ROBUSTA
// ======================
const allowedOrigins = [
  'https://bolao-d2zh.vercel.app',
  'https://bolao-gamma.vercel.app',
  /\.vercel\.app$/,
  /\.netlify\.app$/,
  'https://bolao5.pages.dev',
  /\.pages\.dev$/,   
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8000',
  'http://localhost:8080'
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.some(allowed =>
      typeof allowed === 'string' ? origin === allowed : allowed.test(origin)
    );
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('🚫 Bloqueado pelo CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 204,
  maxAge: 86400 
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ======================
// PARSERS
// ======================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ======================
// MIDDLEWARE DE DEBUG (MOVIDO PARA ANTES DAS ROTAS)
// ======================
app.use((req, res, next) => {
  if (req.path === '/api/events') return next(); 
  console.log('='.repeat(50));
  console.log(`📨 ${req.method} ${req.url}`);
  console.log('📋 Origin:', req.headers.origin || 'Sem Origin');
  console.log('📦 Body KEYS:', Object.keys(req.body || {}));
  if (Object.keys(req.body || {}).length > 0) {
    console.log('📦 Body SAMPLE:', JSON.stringify(req.body).substring(0, 200) + '...');
  }
  console.log('='.repeat(50));
  next();
});

// ======================
// SSE - TEMPO REAL (COM HEARTBEAT ORIGINAL)
// ======================
let sseClients = [];

setInterval(() => {
  if (sseClients.length > 0) {
    sseClients.forEach(client => {
      try {
        client.res.write(': keep-alive\n\n');
      } catch (e) {}
    });
  }
}, 25000);

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); 
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  console.log(`🔌 [SSE] Cliente conectado: ${clientId} | Total: ${sseClients.length}`);
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', id: clientId })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
    console.log(`❌ [SSE] Cliente desconectado: ${clientId}`);
  });
});

const broadcastUpdate = (data) => {
  if (sseClients.length === 0) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try { client.res.write(payload); } catch (err) {
      console.error(`Erro SSE para ${client.id}:`, err.message);
    }
  });
};

// ======================
// BANCO DE DADOS (CONFIGS ORIGINAIS DE TIMEOUT)
// ======================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bolao-copa-2026';

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000, 
    socketTimeoutMS: 45000, 
    retryWrites: true,
    w: 'majority'
  })
  .then(async () => {
    console.log('✅ MongoDB conectado com sucesso!');
    try {
      const matchCollection = mongoose.connection.collection('matches');
      const changeStream = matchCollection.watch([], { fullDocument: 'updateLookup' });
      changeStream.on('change', (change) => {
        const relevantTypes = ['update', 'replace', 'insert'];
        if (relevantTypes.includes(change.operationType)) {
          const doc = change.fullDocument;
          if (doc) {
            console.log(`⚽⚽⚽ [ChangeStream] Enviando atualização via SSE: ${doc._id}`);
            broadcastUpdate({ 
              type: 'MATCH_UPDATE', 
              matchId: doc.matchId || doc._id,
              scoreA: doc.scoreA, scoreB: doc.scoreB,
              status: doc.status, minute: doc.minute,
              penaltiesA: doc.penaltiesA, penaltiesB: doc.penaltiesB,
              timestamp: new Date().toISOString()
            });
          }
        }
      });
      console.log('👀 Monitor de partidas ativo');
    } catch (err) {
      console.error('⚠️ ChangeStream (Replica Set necessário):', err.message);
    }
  })
  .catch(err => {
    console.error('❌ ERRO na conexão com MongoDB:', err.message);
    if (process.env.NODE_ENV === 'development') process.exit(1);
  });

// ======================
// ROTAS E ENDPOINTS
// ======================

app.get('/', (req, res) => {
  res.json({
    message: '🚀 Backend do Bolão da Copa funcionando!',
    version: '1.0.0',
    database: mongoose.connection.readyState === 1 ? '✅ Conectado' : '❌ Desconectado',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
    status: mongoose.connection.readyState === 1 ? 'OK' : 'ERROR',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/bets-info', (req, res) => {
  res.json({
    success: true,
    message: '🏆 API de Palpites - Use as rotas específicas',
    endpoints: { 'GET /api/bets/my-bets': 'Buscar meus palpites', 'POST /api/bets/save': 'Salvar palpites' }
  });
});

// USO DAS ROTAS (ORDEM CORRIGIDA)
app.use('/api/groups', groupRoutes); 
app.use('/api/news', newsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/duels', duelRoutes);
app.use('/api/bets', betsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/points', pointsRoutes);
app.use('/api/points-history', pointsHistoryRoutes);
app.use('/api/admin', adminRoutes); 
app.use('/api/round-history', roundHistoryRoutes);

// ======================
// MIDDLEWARES DE ERRO (LÓGICA ORIGINAL)
// ======================
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: `Rota não encontrada: ${req.originalUrl}` });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('💥 Erro não tratado:', error.message);

  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'Acesso bloqueado por política CORS', origin: req.headers.origin });
  }

  res.status(error.status || 500).json({
    success: false,
    message: 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'production' ? {} : error.message
  });
});

// ======================
// INICIAR SERVIDOR & CRON
// ======================
const PORT = process.env.PORT || 5000;

cron.schedule('*/2 * * * *', async () => {
  console.log('🔄 Atualizando jogos automaticamente...');
  try { await updateMatches(); } catch (err) { console.error('❌ Erro cron:', err.message); }
});

const server = app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🎯 Servidor rodando: http://localhost:${PORT}`);
  console.log(`📊 MongoDB State: ${mongoose.connection.readyState === 1 ? '✅ Conectado' : '❌ Desconectado'}`);
  console.log('='.repeat(50));
});

// Desligamento gracioso
const shutdown = async () => {
  await mongoose.connection.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
