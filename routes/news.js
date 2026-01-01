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

    // 🔒 cooldown de 1 hora
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
        text: msg.text
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
   Últimas 20 frases
========================= */
router.get('/', async (req, res) => {
  try {
    const messages = await NewsMessage.find()
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('user', 'name');

    res.json(
      messages.map(m => ({
        user: m.user?.name || 'Usuário',
        text: m.text,
        createdAt: m.createdAt
      }))
    );
  } catch (err) {
    console.error('Erro ao listar frases:', err);
    res.status(500).json([]);
  }
});

module.exports = router;
