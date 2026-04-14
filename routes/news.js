// routes/news.js
const express = require('express');
const NewsMessage = require('../models/NewsMessage');
const { protect } = require('../middleware/auth');

const router = express.Router();

/* =========================
   POST /api/news
   Criar frase (1 por hora por liga)
========================= */
router.post('/', protect, async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    const { leagueId } = req.body; // 👈 Recebe a liga do front-end

    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'ID da liga não informado' });
    }

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

    // ⏱️ cooldown 1h filtrado por usuário e liga
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const lastMessage = await NewsMessage.findOne({
      user: req.user._id,
      leagueId: leagueId, // 👈 Restringe o cooldown à liga atual
      createdAt: { $gte: oneHourAgo }
    });

    if (lastMessage) {
      return res.status(429).json({
        success: false,
        message: 'Você só pode enviar uma frase por hora nesta liga'
      });
    }

    const msg = await NewsMessage.create({
      user: req.user._id,
      leagueId, // 👈 Salva o vínculo com a liga
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
      message: 'Erro interno ao salvar frase'
    });
  }
});

/* =========================
   GET /api/news
   Últimas 20 frases da liga selecionada
========================= */
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { leagueId } = req.query; // 👈 Filtra por liga via query string

    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'ID da liga é necessário' });
    }

    const messages = await NewsMessage.find({ leagueId }) // 👈 Filtro crucial
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
   Toggle de reação (mantém a lógica existente)
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

    // Remove objetos de emoji que ficaram sem usuários
    message.reactions = message.reactions.filter(
      r => r.users.length > 0
    );

    /* ======================================
       2️⃣ ADICIONA o novo emoji (ou remove se for o mesmo - Toggle)
       Nota: A lógica abaixo assume que se o usuário clicou, ele quer reagir.
       Se quiser toggle puro (clicar no mesmo e remover), 
       a lógica de remoção acima já tratou de limpar. 
       Basta verificar se o emoji clicado era o mesmo que ele já tinha.
    ====================================== */
    let reaction = message.reactions.find(r => r.emoji === emoji);

    if (reaction) {
      reaction.users.push(userId);
    } else {
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
        count: r.users.length,
        reactedByMe: r.users.map(u => u.toString()).includes(userId)
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
