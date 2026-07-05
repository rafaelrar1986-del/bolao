const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const cron = require('node-cron');
const updateMatches = require('./services/matchUpdater');

// ROTAS
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
// ENV CHECK
// ======================
const REQUIRED_ENV_VARS = ['MONGODB_URI'];
const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error('❌ Variáveis faltando:', missingVars);
}

// ======================
// CORS
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

    const allowed = allowedOrigins.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );

    return allowed ? callback(null, true) : callback(new Error('CORS bloqueado'));
  },
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ======================
// SSE (REALTIME)
// ======================
let sseClients = [];

setInterval(() => {
  sseClients.forEach(c => {
    try { c.res.write(': ping\n\n'); } catch {}
  });
}, 25000);

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.push(client);

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== client);
  });
});

function broadcastUpdate(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => {
    try { c.res.write(payload); } catch {}
  });
}

// ======================
// DEBUG
// ======================
app.use((req, res, next) => {
  if (req.path === '/api/events') return next();

  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (res.statusCode >= 400) {
      console.log(`${req.method} ${req.url} ${res.statusCode} (${ms}ms)`);
    }
  });

  next();
});

// ======================
// DATABASE + CHANGE STREAM
// ======================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Mongo conectado');

    const collection = mongoose.connection.collection('matches');
    const stream = collection.watch([], { fullDocument: 'updateLookup' });

    stream.on('change', change => {
  const doc = change.fullDocument;
  if (!doc) return;

  // Payload base
  const payload = {
    type: 'MATCH_UPDATE',
    matchId: doc.matchId,
    apiId: doc.apiId,
    status: doc.status,
    minute: doc.minute,
    scoreA: doc.scoreA,
    scoreB: doc.scoreB,
    penaltiesA: doc.penaltiesA,
    penaltiesB: doc.penaltiesB,
    shootoutDetail: doc.shootoutDetail || [],
    timestamp: new Date().toISOString(),
    goalsDetail: doc.goalsDetail || [],
    possession: doc.possession || { home: 0, away: 0 },
    statistics: doc.statistics || {},
    xg: doc.xg || { home: 0, away: 0 },
    odds: doc.odds || {},
    aiAnalysis: doc.ai_analysis || ''
  };

  // 🔥 TRADUÇÃO DAS ESCALAÇÕES PARA O REALTIME
  // Garante que o Front receba 'titulares' em vez de 'players'
  payload.lineups = {
    home: {
      formation: doc.lineups?.home?.formation || "",
      titulares: doc.lineups?.home?.players || [],      // Tradução aqui
      reservas: doc.lineups?.home?.substitutes || []    // Tradução aqui
    },
    away: {
      formation: doc.lineups?.away?.formation || "",
      titulares: doc.lineups?.away?.players || [],      // Tradução aqui
      reservas: doc.lineups?.away?.substitutes || []    // Tradução aqui
    },
    confirmed: doc.lineups?.confirmed || false
  };

  broadcastUpdate(payload);
});
    console.log('👀 ChangeStream ativo');
  })
  .catch(err => console.error('❌ Mongo erro:', err.message));

// ======================
// ROUTES
// ======================
app.get('/', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
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

// ======================
// ERROR
// ======================
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ success: false, message: err.message });
});

// ======================
// CRON
// ======================
cron.schedule('*/1 * * * *', async () => {
  try {
    await updateMatches();
    console.log('🔄 updater rodou');
  } catch (e) {
    console.error('❌ updater erro:', e.message);
  }
});

// ======================
// START
// ======================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server rodando na porta ${PORT}`);
});

module.exports = app;
