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
const rankingRoutes = require('./routes/rankingRoutes'); // ✅ Nova rota para Ranking Oficial/Parcial
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
// CONFIGURAÇÃO CORS CORRIGIDA - FUNCIONANDO PARA VERCEL
// ======================
const allowedOrigins = [
  'https://bolao-d2zh.vercel.app',
  'https://bolao-gamma.vercel.app',
  /\.vercel\.app$/, // todos os subdomínios vercel
  /\.netlify\.app$/, // todos os subdomínios netlify
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
// [NOVO] IMPLEMENTAÇÃO SSE - TEMPO REAL
// ======================
let sseClients = [];

// Heartbeat para manter conexão viva no Render/Vercel/Cloudflare
setInterval(() => {
  if (sseClients.length > 0) {
    sseClients.forEach(client => {
      try {
        client.res.write(': keep-alive\n\n');
      } catch (e) {
        // Falha silenciosa
      }
    });
  }
}, 25000);

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Crítico para Render/Nginx
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
    try {
      client.res.write(payload);
    } catch (err) {
      console.error(`Erro ao enviar SSE para ${client.id}:`, err.message);
    }
  });
};

// ======================
// MIDDLEWARE DE DEBUG
// ======================
app.use((req, res, next) => {
  if (req.path === '/api/events') return next(); // Não logar SSE constante
  console.log('='.repeat(50));
  console.log(`📨 ${req.method} ${req.url}`);
  console.log('📋 Origin:', req.headers.origin);
  console.log('📦 Body KEYS:', Object.keys(req.body || {}));
  if (Object.keys(req.body || {}).length > 0) {
    console.log('📦 Body SAMPLE:', JSON.stringify(req.body).substring(0, 200) + '...');
  }
  console.log('='.repeat(50));
  next();
});

// ======================
// BANCO DE DADOS - CONEXÃO + MONITORAMENTO REAL-TIME
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
    console.log('📊 Database:', mongoose.connection.name);
    console.log('🔗 Host:', mongoose.connection.host);

    // [REAL-TIME] Monitorando mudanças na coleção de partidas via ChangeStream
    try {
      const matchCollection = mongoose.connection.collection('matches');
      // { fullDocument: 'updateLookup' } garante que o documento completo venha no evento de 'update'
      const changeStream = matchCollection.watch([], { fullDocument: 'updateLookup' });

      changeStream.on('change', (change) => {
        const relevantTypes = ['update', 'replace', 'insert'];
        
        if (relevantTypes.includes(change.operationType)) {
          const doc = change.fullDocument;
          
          if (doc) {
            console.log(`⚽ [ChangeStream] Enviando atualização via SSE: ${doc._id}`);
            
            // Enviamos o pacote COMPLETO para o frontend realizar a atualização cirúrgica
            broadcastUpdate({ 
              type: 'MATCH_UPDATE', 
              matchId: doc.matchId || doc._id, // Envia ambos para garantir o "match" no front
              scoreA: doc.scoreA,
              scoreB: doc.scoreB,
              status: doc.status,
              minute: doc.minute,
              penaltiesA: doc.penaltiesA,
              penaltiesB: doc.penaltiesB,
              timestamp: new Date().toISOString()
            });
          }
        }
      });
      console.log('👀 Monitor de partidas ativo (Real-time pronto)');
    } catch (streamError) {
      console.error('⚠️ ChangeStream não suportado (Requer Replica Set):', streamError.message);
    }

  })
  .catch(err => {
    console.error('❌ ERRO na conexão com MongoDB:');
    console.error('- String de conexão:', MONGODB_URI.substring(0, 20) + '...');
    console.error('- Erro detalhado:', err.message);
    
    if (process.env.NODE_ENV === 'development') {
      process.exit(1);
    }
  });

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
// ROTAS - USO (DEFINIÇÃO DE ENDPOINTS)
// ======================

app.get('/', (req, res) => {
  res.json({
    message: '🚀 Backend do Bolão da Copa funcionando!',
    version: '1.0.0',
    database: mongoose.connection.readyState === 1 ? '✅ Conectado' : '❌ Desconectado',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
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
    timestamp: new Date().toISOString()
  });
});

// ✅ ROTA INICIAL PARA INFORMAÇÕES DE PALPITES
app.get('/api/bets-info', (req, res) => {
  res.json({
    success: true,
    message: '🏆 API de Palpites - Use as rotas específicas',
    endpoints: {
      'GET /api/bets/my-bets': 'Buscar meus palpites',
      'POST /api/bets/save': 'Salvar palpites',
      'GET /api/bets/status': 'Verificar status'
    },
    timestamp: new Date().toISOString()
  });
});

// Definição das Rotas Funcionais
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
app.use('/api/email-broadcast', adminRoutes);

// ======================
// MIDDLEWARES DE ERRO
// ======================

app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Rota não encontrada: ${req.originalUrl}`,
    method: req.method
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('💥 Erro não tratado:', error);

  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'Acesso bloqueado por política CORS',
      origin: req.headers.origin
    });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Erro de validação',
      errors: Object.values(error.errors).map(err => err.message)
    });
  }

  if (error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Dados duplicados',
      field: Object.keys(error.keyPattern)[0]
    });
  }

  res.status(error.status || 500).json({
    success: false,
    message: 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'production' ? {} : error.message
  });
});

// ======================
// DESLIGAMENTO GRACIOSO
// ======================
const shutdown = async () => {
  console.log('🛑 Desligando servidor graciosamente...');
  await mongoose.connection.close();
  console.log('✅ MongoDB desconectado');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ======================
// INICIAR SERVIDOR
// ======================
const PORT = process.env.PORT || 5000;

// CRON AUTOMÁTICO - A cada 2 minutos
cron.schedule('*/2 * * * *', async () => {
  console.log('🔄 Atualizando jogos automaticamente...');
  try {
    await updateMatches();
  } catch (err) {
    console.error('❌ Erro no cron de atualização:', err.message);
  }
});

const server = app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🎯 Servidor rodando: http://localhost:${PORT}`);
  console.log(`📊 MongoDB State: ${mongoose.connection.readyState === 1 ? '✅ Conectado' : '❌ Desconectado'}`);
  console.log(`🕒 Iniciado em: ${new Date().toLocaleString('pt-BR')}`);
  console.log('='.repeat(50));
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Porta ${PORT} já está em uso!`);
  } else {
    console.error('❌ Erro no servidor:', error);
  }
  process.exit(1);
});

module.exports = app;
