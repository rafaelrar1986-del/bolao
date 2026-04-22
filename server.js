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
const rankingRoutes = require('./routes/rankingRoutes');
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
}

// ======================
// CONFIGURAÇÃO CORS CORRIGIDA
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
    return isAllowed ? callback(null, true) : callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
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
// IMPLEMENTAÇÃO SSE - TEMPO REAL
// ======================
let sseClients = [];

setInterval(() => {
  if (sseClients.length > 0) {
    sseClients.forEach(client => {
      try { client.res.write(': keep-alive\n\n'); } catch (e) {}
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
    try { client.res.write(payload); } catch (err) {}
  });
};

// ======================
// MIDDLEWARE DE DEBUG
// ======================
app.use((req, res, next) => {
  if (req.path === '/api/events') return next();
  console.log('='.repeat(50));
  console.log(`📨 ${req.method} ${req.url}`);
  console.log('📋 Origin:', req.headers.origin);
  console.log('📦 Body KEYS:', Object.keys(req.body || {}));
  console.log('='.repeat(50));
  next();
});

// ======================
// BANCO DE DADOS - CONEXÃO COM FIX DE ÍNDICES
// ======================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bolao-copa-2026';

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    autoIndex: false, // 🚀 BLOQUEIA CRIAÇÃO AUTOMÁTICA DE ÍNDICES PROBLEMÁTICOS
    serverSelectionTimeoutMS: 30000, 
    socketTimeoutMS: 45000, 
    retryWrites: true,
    w: 'majority'
  })
  .then(async () => {
    console.log('✅ MongoDB conectado com sucesso!');

    // 🧹 LIMPEZA MANUAL DE ÍNDICES FANTASMAS (Roda uma vez no boot)
    try {
      const settingsColl = mongoose.connection.collection('settings');
      await settingsColl.dropIndex('key_1').catch(() => {});
      await settingsColl.dropIndex('key_1_leagueId_1').catch(() => {});
      console.log('🧹 Limpeza de índices antigos executada.');
    } catch (e) {}

    // [REAL-TIME] ChangeStream - ATUALIZADO
try {
  const matchCollection = mongoose.connection.collection('matches');
  const changeStream = matchCollection.watch([], { fullDocument: 'updateLookup' });

  changeStream.on('change', (change) => {
    if (['update', 'replace', 'insert'].includes(change.operationType)) {
      const doc = change.fullDocument;
      if (doc) {
        // --- ADICIONADO PENALTIESA E PENALTIESB ABAIXO ---
        broadcastUpdate({ 
          type: 'MATCH_UPDATE', 
          matchId: doc.matchId || doc._id,
          scoreA: doc.scoreA, 
          scoreB: doc.scoreB,
          penaltiesA: doc.penaltiesA, // <--- O QUE FALTA
          penaltiesB: doc.penaltiesB, // <--- O QUE FALTA
          status: doc.status, 
          minute: doc.minute,
          timestamp: new Date().toISOString()
        });
        
        // Log para você ver no terminal do servidor se está enviando
        if (doc.status === 'penaltis') {
          console.log(`📡 SSE Enviado (Pênaltis): ${doc.matchId} -> ${doc.penaltiesA}x${doc.penaltiesB}`);
        }
      }
    }
  });
  console.log('👀 Monitor de partidas ativo (Real-time pronto)');
} catch (streamError) {
  console.error('⚠️ ChangeStream não suportado');
}
  })
  .catch(err => console.error('❌ ERRO MongoDB:', err.message));

// ======================
// ROTAS
// ======================
app.get('/', (req, res) => {
  res.json({ message: '🚀 Backend do Bolão funcionando!', version: '1.0.1', database: '✅ Conectado' });
});

app.use('/api/groups', groupRoutes); 
app.use('/api/bets', rankingRoutes);
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
// MIDDLEWARES DE ERRO
// ======================
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('💥 Erro:', error.message);

  if (error.code === 11000) {
    return res.status(400).json({ success: false, message: 'Dados duplicados detectados no banco.' });
  }

  res.status(error.status || 500).json({
    success: false,
    message: 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'production' ? {} : error.message
  });
});

// ======================
// CRON E SERVIDOR
// ======================
cron.schedule('*/1 * * * *', async () => {
  console.log('🔄 Atualizando jogos...');
  try { await updateMatches(); } catch (err) { console.error('❌ Erro no cron:', err.message); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🎯 Servidor rodando na porta ${PORT}`);
  console.log('='.repeat(50));
});

module.exports = app;
