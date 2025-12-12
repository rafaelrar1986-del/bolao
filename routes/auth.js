// Auth routes - login + password reset placeholders
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    // compare password using model method (handles bcrypt/legacy)
    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    // create token payload
    const payload = { id: user._id, email: user.email, name: user.name, isAdmin: user.isAdmin || false };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    // respond with token and sanitized user
    const safeUser = user.toJSON ? user.toJSON() : { id: user._id, email: user.email, name: user.name };
    return res.json({ success: true, token, user: safeUser });
  } catch (err) {
    console.error('Auth login error', err);
    return res.status(500).json({ success: false, message: 'Erro no servidor' });
  }
});

// POST /api/auth/request-password-reset
router.post('/request-password-reset', async (req, res) => {
  // keep previous behavior: always respond success to avoid enumeration
  res.json({ success: true });
  // actual implementation should find user, create token, send email, etc.
});

// POST /api/auth/verify-reset-token
router.post('/verify-reset-token', async (req, res) => {
  return res.status(400).json({ valid: false });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  return res.status(400).json({ success: false });
});

module.exports = router;
