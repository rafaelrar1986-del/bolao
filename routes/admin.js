// routes/admin.js
const express = require('express');
const User = require('../models/User');
const Setting = require('../models/Setting');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

// Listar usuários (id, name, email, isAdmin, lastLogin, createdAt, betsBlocked)
router.get('/users', protect, admin, async (req, res) => {
  try {
    const users = await User.find({}, 'name email isAdmin lastLogin createdAt betsBlocked').sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: users });
  } catch (e) {
    console.error('GET /admin/users error:', e);
    res.status(500).json({ success: false, message: 'Erro ao listar usuários' });
  }
});

// Deletar usuário
router.delete('/users/:id', protect, admin, async (req, res) => {
  try {
    const { id } = req.params;
    if (String(id) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: 'Você não pode deletar a si mesmo.' });
    }
    const deleted = await User.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    res.json({ success: true, message: 'Usuário deletado' });
  } catch (e) {
    console.error('DELETE /admin/users/:id error:', e);
    res.status(500).json({ success: false, message: 'Erro ao deletar usuário' });
  }
});

// Bloqueio GLOBAL de envio de palpites
router.get('/bets-lock', protect, admin, async (req, res) => {
  try {
    const locked = await Setting.get('betsLocked', false);
    res.json({ success: true, locked: !!locked });
  } catch (e) {
    console.error('GET /admin/bets-lock error:', e);
    res.status(500).json({ success: false, message: 'Erro ao ler bloqueio global' });
  }
});

router.post('/bets-lock', protect, admin, async (req, res) => {
  try {
    const { locked } = req.body || {};
    await Setting.set('betsLocked', !!locked);
    res.json({ success: true, locked: !!locked, message: `Envio de palpites ${locked ? 'bloqueado' : 'desbloqueado'}.` });
  } catch (e) {
    console.error('POST /admin/bets-lock error:', e);
    res.status(500).json({ success: false, message: 'Erro ao atualizar bloqueio global' });
  }
});

// Opcional: bloquear/desbloquear um usuário específico (flag betsBlocked)
router.post('/users/:id/block-bets', protect, admin, async (req, res) => {
  try {
    const { id } = req.params;
    const { blocked } = req.body || {};
    const user = await User.findByIdAndUpdate(id, { betsBlocked: !!blocked }, { new: true, fields: 'name email betsBlocked' });
    if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    res.json({ success: true, data: user, message: `Apostas para ${user.name} ${blocked ? 'bloqueadas' : 'desbloqueadas'}.` });
  } catch (e) {
    console.error('POST /admin/users/:id/block-bets error:', e);
    res.status(500).json({ success: false, message: 'Erro ao atualizar usuário' });
  }
});

module.exports = router;
