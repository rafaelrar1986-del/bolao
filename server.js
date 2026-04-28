const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const cron = require('node-cron');
const updateMatches = require('./services/matchUpdater');

// IMPORTAÇÃO DE ROTAS
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

// CONFIGURAÇÃO DE VARIÁVEIS DE AMBIENTE
const REQUIRED_ENV_VARS = ['MONGODB_URI'];
const missingVars = REQUIRED_ENV_VARS.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('❌ CRÍTICO: Variáveis de ambiente faltando:', missingVars);
}

// CONFIGURAÇÃO CORS
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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// IMPLEMENTAÇÃO SSE
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

// MIDDLEWARE DE DEBUG
app.use((req, res, next) => {
  if (req.path === '/api/events') return next();
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// BANCO DE DADOS E CHANGESTREAM
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI) // Versões modernas do Mongoose não precisam mais das opções depreciadas
  .then(async () => {
    console.log('✅ [DATABASE] MongoDB conectado com sucesso!');

    try {
      const settingsColl = mongoose.connection.collection('settings');
      await settingsColl.dropIndex('key_1').catch(() => {});
      await settingsColl.dropIndex('key_1_leagueId_1').catch(() => {});
      console.log('🧹 [DATABASE] Limpeza de índices antigos executada.');
    } catch (e) {}

    // REAL-TIME CHANGESTREAM
    try {
      const matchCollection = mongoose.connection.collection('matches');
      const changeStream = matchCollection.watch([], { fullDocument: 'updateLookup' });

      changeStream.on('change', (change) => {
        try {
          const { operationType, updateDescription, fullDocument: doc } = change;
          if (!['update', 'replace', 'insert'].includes(operationType) || !doc) return;

          const payload = {
            type: 'MATCH_UPDATE',
            matchId: doc.matchId || doc._id,
            apiId: doc.apiId,
            status: doc.status,
            minute: doc.minute,
            scoreA: doc.scoreA,
            scoreB: doc.scoreB,
            penaltiesA: doc.penaltiesA,
            penaltiesB: doc.penaltiesB,
            timestamp: new Date().toISOString()
          };

          if (operationType === 'update' && updateDescription) {
            const updatedFields = updateDescription.updatedFields || {};
            const keys = Object.keys(updatedFields);

            console.log(`🔍 [STREAM] Update: ${doc.teamA} x ${doc.teamB} | Alterações: ${keys.join(', ')}`);

            if (updatedFields.goalsDetail !== undefined) payload.goalsDetail = doc.goalsDetail;
            if (updatedFields.possession !== undefined) payload.possession = doc.possession;
            if (updatedFields.statistics !== undefined) payload.statistics = doc.statistics;
            if (updatedFields.lineups !== undefined) payload.lineups = doc.lineups;

            if (updatedFields.scoreA !== undefined || updatedFields.scoreB !== undefined) {
              console.log(`⚽ [GOL]: ${doc.teamA} ${doc.scoreA}x${doc.scoreB} ${doc.teamB}`);
            }
          } else {
            payload.goalsDetail = doc.goalsDetail || [];
            payload.possession = doc.possession || { home: 0, away: 0 };
            payload.statistics = doc.statistics || [];
            payload.lineups = doc.lineups || { home: {}, away: {} };
          }

          broadcastUpdate(payload);
        } catch (innerError) {
          console.error('❌ [STREAM ERROR]:', innerError.message);
        }
      });

      changeStream.on('error', (err) => console.error('❌ [STREAM CRITICAL]:', err.message));
      console.log('👀 [STREAM] Monitoramento ativo.');

    } catch (streamError) {
      console.error('⚠️ [STREAM] Falha ao iniciar ChangeStream:', streamError.message);
    }
  })
  .catch(err => console.error('❌ [DATABASE] Erro fatal:', err.message));

// ROTAS
app.get('/', (req, res) => {
  res.json({ status: 'online', version: '1.0.1', timestamp: new Date().toISOString() });
});

app.use('/api/groups', groupRoutes); 
app.use('/api/rankings', rankingRoutes); 
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

// MIDDLEWARES DE ERRO
app.use((error, req, res, next) => {
  console.error(`💥 [ERRO]: ${error.message}`);
  const status = error.status || 500;
  res.status(status).json({
    success: false,
    message: error.message || 'Erro interno do servidor'
  });
});

// CRON E SERVIDOR
cron.schedule('*/1 * * * *', async () => {
  try { 
    await updateMatches(); 
    console.log('✅ [CRON] Sincronização concluída.');
  } catch (err) { 
    console.error('❌ [CRON] Erro:', err.message); 
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🎯 Servidor na porta ${PORT} - ${new Date().toLocaleString()}`);
});

module.exports = app;
