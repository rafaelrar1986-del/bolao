const express = require('express');
const NewsMessage = require('../models/NewsMessage');
const { protect } = require('../middleware/auth');

const router = express.Router();

/* =========================
   POST /api/news
   Criar frase (1 por hora)
========================= */
router.post('/', protect, async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();

    if (!text || text.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'A frase deve ter pelo menos 3 caracteres'
      });
    }

    if (text.length > 80) {
      return res.status(400).json({
        success: false,
        message: 'A frase pode ter no máximo 80 caracteres'
      });
    }

    // ⏱️ cooldown 1h
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const lastMessage = await NewsMessage.findOne({
      user: req.user._id,
      createdAt: { $gte: oneHourAgo }
    });

    if (lastMessage) {
      return res.status(429).json({
        success: false,
        message: 'Você só pode enviar uma frase por hora'
      });
    }

    const msg = await NewsMessage.create({
      user: req.user._id,
      text
    });

    res.json({
      success: true,
      data: {
        id: msg._id,
        text: msg.text,
        createdAt: msg.createdAt
      }
    });
  } catch (err) {
    console.error('Erro ao criar frase:', err);
    res.status(500).json({
      success: false,
      message: 'Erro interno'
    });
  }
});

/* =========================
   GET /api/news
   Últimas 20 frases (com reações do usuário)
========================= */
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    const messages = await NewsMessage.find()
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('user', 'name')
      .lean();

    res.json(
      messages.map(m => ({
        id: m._id,
        user: {
          id: m.user?._id,
          name: m.user?.name || 'Usuário'
        },
        text: m.text,
        createdAt: m.createdAt,
        reactions: (m.reactions || []).map(r => ({
          emoji: r.emoji,
          count: r.users.length,
          reactedByMe: r.users
            .map(u => u.toString())
            .includes(userId)
        }))
      }))
    );
  } catch (err) {
    console.error('Erro ao listar frases:', err);
    res.status(500).json([]);
  }
});

/* =========================
   POST /api/news/:id/react
   1 reação por usuário
========================= */
router.post('/:id/react', protect, async (req, res) => {
  try {
    const { emoji } = req.body;
    const userId = req.user._id.toString();
    const messageId = req.params.id;

    if (!emoji || typeof emoji !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Emoji inválido'
      });
    }

    const message = await NewsMessage.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Frase não encontrada'
      });
    }

    /* ======================================
       1️⃣ REMOVE usuário de TODAS as reações
    ====================================== */
    message.reactions.forEach(r => {
      r.users = r.users.filter(
        u => u.toString() !== userId
      );
    });

    // remove emojis vazios
    message.reactions = message.reactions.filter(
      r => r.users.length > 0
    );

    /* ======================================
       2️⃣ TOGGLE do emoji clicado
    ====================================== */
    let reaction = message.reactions.find(r => r.emoji === emoji);

    if (reaction) {
      // se já existia, adiciona o usuário
      reaction.users.push(userId);
    } else {
      // cria nova reação
      message.reactions.push({
        emoji,
        users: [userId]
      });
    }

    await message.save();

    res.json({
      success: true,
      reactions: message.reactions.map(r => ({
        emoji: r.emoji,
        count: r.users.length
      }))
    });

  } catch (err) {
    console.error('Erro ao reagir:', err);
    res.status(500).json({
      success: false,
      message: 'Erro interno'
    });
  }
});


module.exports = router;
