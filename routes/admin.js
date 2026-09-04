const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Importações de Modelos e Serviços
const AllowedEmail = require('../models/AllowedEmail'); 
const User = require('../models/User');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const League = require('../models/League');
const BetReceipt = require('../models/BetReceipt');
const { sendBroadcastEmail } = require('../services/emailService');
const { protect, admin } = require('../middleware/auth');

// Importação do Controller do Robô
const robotController = require('../controllers/robotController');

// Configuração do Multer
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } 
});

/**
 * @route    GET /api/admin/leagues
 * @desc     Lista campeonatos/ligações disponíveis para o painel Admin.
 *           O cadastro em League permite que uma liga exista mesmo sem partidas.
 */
router.get('/leagues', protect, admin, async (req, res) => {
  try {
    const [registered, existing] = await Promise.all([
      League.find({}).sort({ name: 1 }).lean(),
      Match.aggregate([
        { $match: { leagueId: { $ne: null } } },
        { $group: {
          _id: '$leagueId',
          name: { $first: '$leagueName' },
          count: { $sum: 1 }
        } }
      ])
    ]);

    const byId = new Map(registered.map(l => [String(l.leagueId), l]));
    // Compatibilidade: ligas antigas continuam aparecendo sem exigir migração.
    for (const item of existing) {
      const id = String(item._id);
      if (!byId.has(id)) {
        byId.set(id, {
          leagueId: id,
          name: item.name || `Liga ${id}`,
          source: 'api',
          apiLeagueId: Number.isFinite(Number(id)) ? Number(id) : null,
          apiLeagueName: item.name || '',
          startDate: null,
          endDate: null,
          status: 'active',
          legacy: true
        });
      }
    }

    const data = [...byId.values()]
      .filter(l => l.status !== 'archived')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));

    return res.json({ success: true, data });
  } catch (error) {
    console.error('❌ Erro ao listar campeonatos do Admin:', error);
    return res.status(500).json({ success: false, message: 'Erro ao carregar campeonatos.' });
  }
});

/**
 * @route    POST /api/admin/leagues
 * @desc     Cria um campeonato manual ou vinculado a uma competição da API.
 *           leagueId continua sendo a identidade usada pelo restante do sistema.
 */
router.post('/leagues', protect, admin, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const source = req.body?.source === 'api' ? 'api' : 'manual';
    const apiLeagueId = req.body?.apiLeagueId == null || req.body?.apiLeagueId === ''
      ? null : Number(req.body.apiLeagueId);
    const startDate = req.body?.startDate ? new Date(req.body.startDate) : null;
    const endDate = req.body?.endDate ? new Date(req.body.endDate) : null;

    if (!name) return res.status(400).json({ success: false, message: 'Nome do campeonato é obrigatório.' });
    if (source === 'api' && (!Number.isInteger(apiLeagueId) || apiLeagueId <= 0)) {
      return res.status(400).json({ success: false, message: 'Selecione um campeonato válido da API.' });
    }
    if (startDate && Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Data de início inválida.' });
    }
    if (endDate && Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Data final inválida.' });
    }
    if (source === 'api' && (!startDate || !endDate)) {
      return res.status(400).json({ success: false, message: 'A competição da API precisa fornecer as datas da temporada atual.' });
    }
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ success: false, message: 'A data de início não pode ser posterior à data final.' });
    }

    // Mantemos leagueId como identidade única em todo o sistema. Para ligas
    // manuais usamos um ID numérico interno (em string), pois módulos legados
    // ainda convertem leagueId para número em alguns pontos do sistema.
    let leagueId = source === 'api' ? String(apiLeagueId) : String(Date.now());
    let existing = await League.findOne({ leagueId }).lean();
    let existingMatch = await Match.findOne({ leagueId }).select('_id leagueName').lean();
    while (source === 'manual' && (existing || existingMatch)) {
      leagueId = String(Number(leagueId) + 1);
      existing = await League.findOne({ leagueId }).lean();
      existingMatch = await Match.findOne({ leagueId }).select('_id leagueName').lean();
    }

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Já existe um campeonato com o leagueId ${leagueId}.`,
        leagueId
      });
    }

    // Se a competição já possui partidas legadas em Match, adotamos esse
    // leagueId no cadastro League em vez de bloquear a criação. Assim o novo
    // gerenciamento passa a reconhecer formalmente a liga sem migrar partidas.
    if (source === 'api' && existingMatch) {
      const legacyName = existingMatch.leagueName || name;
      const league = await League.create({
        leagueId,
        name: name || legacyName,
        source,
        apiLeagueId,
        apiLeagueName: name || legacyName,
        startDate,
        endDate,
        status: 'active',
        createdBy: req.user?._id || null
      });
      await Settings.findByIdAndUpdate(
        leagueId,
        { $setOnInsert: { leagueId, status: 'open' } },
        { upsert: true, new: true }
      );
      return res.status(201).json({ success: true, data: league, adoptedLegacyMatches: true });
    }

    const league = await League.create({
      leagueId,
      name,
      source,
      apiLeagueId: source === 'api' ? apiLeagueId : null,
      apiLeagueName: source === 'api' ? name : '',
      startDate,
      endDate,
      status: 'active',
      createdBy: req.user?._id || null
    });

    // Cria as configurações mínimas imediatamente, permitindo administrar a liga
    // antes da primeira partida.
    await Settings.findByIdAndUpdate(
      leagueId,
      { $setOnInsert: { leagueId, status: 'open' } },
      { upsert: true, new: true }
    );

    return res.status(201).json({ success: true, data: league });
  } catch (error) {
    console.error('❌ Erro ao criar campeonato:', error);
    return res.status(500).json({ success: false, message: 'Erro ao criar campeonato.' });
  }
});

/**
 * @route    GET /api/admin/robot/available-leagues
 * @desc     Busca a lista de ligas disponíveis na API externa de esportes
 */
router.get('/robot/available-leagues', protect, admin, robotController.getAvailableLeagues);

/**
 * @route    POST /api/admin/robot/sync
 * @desc     Sincroniza partidas da API externa (Bzzoiro) com paginação
 */
router.post('/robot/sync', protect, admin, robotController.fetchAndSyncMatches);

/**
 * @route    GET /api/admin/users
 * @desc     Lista todos os usuários (CORRIGIDO PARA O FRONTEND)
 */
router.get('/users', protect, admin, async (req, res) => {
  try {
    // Buscamos os campos necessários, incluindo o hasPaid que estava faltando antes
    const users = await User.find({}, 'name email isAdmin hasPaid createdAt').sort({ createdAt: -1 });
    
    // IMPORTANTE: O frontend espera um objeto com a propriedade "users"
    res.json({
      success: true,
      users: users 
    });
  } catch (error) {
    console.error('❌ Erro ao buscar usuários:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários.' });
  }
});

/**
 * @route    PUT /api/admin/approve-user/:id
 * @desc     Aprova manualmente o pagamento de um usuário
 */
router.put('/approve-user/:id', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }

    user.hasPaid = true; 
    await user.save();

    console.log(`💰 Usuário aprovado: ${user.email}`);
    res.json({ success: true, message: `Pagamento de ${user.name} aprovado!` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route    POST /api/admin/send
 * @desc     Envia e-mail para todos os participantes da Whitelist
 */
router.post('/send', protect, admin, upload.single('attachment'), async (req, res) => {
  try {
    const { subject, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ 
        success: false, 
        message: `Dados ausentes. Verifique o preenchimento.` 
      });
    }

    const docs = await AllowedEmail.find({}, 'email');
    const emailList = docs.map(d => d.email);

    if (emailList.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Whitelist vazia.' 
      });
    }

    await sendBroadcastEmail(emailList, subject, message, req.file);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.json({ 
      success: true, 
      message: `E-mails enviados para ${emailList.length} participantes!` 
    });

  } catch (error) {
    console.error('❌ Erro no broadcast:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Falha ao processar o envio.' 
    });
  }
});


/**
 * @route    GET /api/admin/bet-receipts/validate
 * @desc     Valida um protocolo de comprovante e informa o participante.
 */
router.get('/bet-receipts/validate', protect, admin, async (req, res) => {
  try {
    const protocol = String(req.query.protocol || '').trim();
    const leagueId = req.query.leagueId != null ? String(req.query.leagueId).trim() : '';
    if (!protocol) {
      return res.status(400).json({ success: false, message: 'Informe o protocolo.' });
    }

    const receipt = await BetReceipt.findOne(leagueId ? { protocol, leagueId } : { protocol })
      .populate('user', 'name email')
      .lean();

    if (!receipt) {
      return res.status(404).json({
        success: false,
        valid: false,
        status: 'not_found',
        message: 'Protocolo não encontrado.'
      });
    }

    let currentReceipt = receipt;
    if (!receipt.isCurrent) {
      currentReceipt = await BetReceipt.findOne({
        user: receipt.user?._id || receipt.user,
        leagueId: receipt.leagueId,
        isCurrent: true
      }).sort({ version: -1 }).lean();
    }

    const currentProtocol = currentReceipt?.protocol || null;

    return res.json({
      success: true,
      valid: receipt.isCurrent === true,
      status: receipt.isCurrent === true ? 'current' : 'historical',
      receipt: {
        protocol: receipt.protocol,
        version: receipt.version,
        operation: receipt.operation,
        createdAt: receipt.createdAt,
        isCurrent: receipt.isCurrent === true,
        leagueId: receipt.leagueId,
        snapshotHash: receipt.snapshotHash,
        email: receipt.email || null,
        user: receipt.user ? {
          id: receipt.user._id,
          name: receipt.user.name || 'Participante',
          email: receipt.user.email || ''
        } : null
      },
      currentProtocol
    });
  } catch (error) {
    console.error('❌ Erro ao validar protocolo:', error);
    return res.status(500).json({ success: false, message: 'Erro ao consultar o protocolo.' });
  }
});

module.exports = router;
