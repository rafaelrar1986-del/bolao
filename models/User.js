const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  recoveryCode: String,
  name: {
    type: String,
    required: [true, 'Nome é obrigatório'],
    trim: true,
    minlength: [2, 'Nome deve ter pelo menos 2 caracteres'],
    maxlength: [50, 'Nome não pode exceder 50 caracteres']
  },
  email: {
    type: String,
    required: [true, 'Email é obrigatório'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Por favor, informe um email válido']
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
    default: null
  },
  password: {
    type: String,
    required: [true, 'Senha é obrigatória'],
    minlength: [6, 'Senha deve ter pelo menos 6 caracteres']
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  // 💰 CONTROLE DE PAGAMENTO
  hasPaid: {
    type: Boolean,
    default: false
  },

  // 💰 PAGAMENTOS INDIVIDUAIS POR CAMPEONAMENTO.
  // Mantemos hasPaid apenas para compatibilidade com usuários legados.
  // A autorização atual usa paidLeagues + leagueId.
  paidLeagues: {
    type: [String],
    default: []
  },
  // 📋 SOLICITAÇÕES DE ENTRADA/PAGAMENTO POR CAMPEONAMENTO.
  // Uma solicitação existe apenas enquanto está pendente. Ao aprovar ou
  // desaprovar, ela é removida; paidLeagues/leagues representam o estado atual.
  leaguePaymentRequests: {
    type: [String],
    default: []
  },
  passwordVersion: {
    type: Number,
    default: 1, // 1 = bcrypt, 2 = crypto fallback
    enum: [1, 2]
  },
  needsRehash: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date,
    default: null
  },
  loginAttempts: {
    type: Number,
    default: 0,
    max: 5
  },
  lockUntil: {
    type: Date,
    default: null
  },
  // 🏆 LIGAS QUE O USUÁRIO PARTICIPA
  // 🆕 CORREÇÃO CRÍTICA: Alterado de [Number] para [String] para alinhar
  // com toLeagueId() usado em todo o sistema (Matches.js, bets.js, pointsService.js)
  leagues: {
    type: [String],
    default: []
  },

  // 🖼️ AVATAR DO USUÁRIO (usado no leaderboard e perfil)
  avatar: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.loginAttempts;
      delete ret.lockUntil;
      return ret;
    }
  }
});

// ======================
// VIRTUAIS
// ======================

// Verificar se a conta está bloqueada
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ======================
// MIDDLEWARES (HOOKS)
// ======================

userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;

  try {
    if (this.passwordVersion === 1) {
      this.password = await bcrypt.hash(this.password, 12);
    } 
    else if (this.passwordVersion === 2) {
      this.password = this.createHashFallback(this.password);
    }
    
    this.loginAttempts = 0;
    this.lockUntil = null;
    return;
  } catch (error) {
    this.passwordVersion = 2;
    this.password = this.createHashFallback(this.password);
    this.needsRehash = true;
    return;
  }
});

// ======================
// MÉTODOS DE INSTÂNCIA
// ======================

// 🔥 NOVO MÉTODO: Aprovar pagamento do usuário
userSchema.methods.approvePayment = async function(leagueId) {
  const id = leagueId == null ? '' : String(leagueId).trim();
  if (!id) throw new Error('leagueId é obrigatório para aprovar pagamento.');

  const paidLeagues = Array.isArray(this.paidLeagues)
    ? this.paidLeagues.map(String)
    : [];
  if (!paidLeagues.includes(id)) paidLeagues.push(id);

  this.paidLeagues = paidLeagues;
  return await this.save();
};

userSchema.methods.comparePassword = async function(candidatePassword) {
  if (this.isLocked) {
    throw new Error('Conta bloqueada temporariamente. Tente novamente mais tarde.');
  }

  let isMatch = false;

  try {
    if (this.passwordVersion === 1) {
      isMatch = await bcrypt.compare(candidatePassword, this.password);
    }
    else if (this.passwordVersion === 2) {
      const candidateHash = this.createHashFallback(candidatePassword);
      isMatch = candidateHash === this.password;
    }

    if (isMatch) {
      this.loginAttempts = 0;
      this.lastLogin = new Date();
      await this.save();
    } else {
      this.loginAttempts += 1;
      if (this.loginAttempts >= 5) {
        this.lockUntil = Date.now() + (30 * 60 * 1000);
      }
      await this.save();
    }

    return isMatch;

  } catch (error) {
    if (this.passwordVersion === 1 && error.message.includes('bcrypt')) {
      const candidateHash = this.createHashFallback(candidatePassword);
      isMatch = candidateHash === this.password;
      if (isMatch) {
        this.passwordVersion = 2;
        this.needsRehash = false;
        await this.save();
      }
      return isMatch;
    }
    return false;
  }
};

userSchema.methods.createHashFallback = function(password) {
  return crypto
    .createHash('sha256')
    .update(password + (process.env.JWT_SECRET || 'fallback-secret'))
    .digest('hex');
};

userSchema.methods.resetLock = async function() {
  this.loginAttempts = 0;
  this.lockUntil = null;
  await this.save();
  return this;
};

// ======================
// MÉTODOS ESTÁTICOS
// ======================

userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase().trim() });
};

userSchema.statics.getSecurityStats = async function() {
  const totalUsers = await this.countDocuments();
  const bcryptUsers = await this.countDocuments({ passwordVersion: 1 });
  const cryptoUsers = await this.countDocuments({ passwordVersion: 2 });
  const unpaidUsers = await this.countDocuments({
    $and: [
      { hasPaid: { $ne: true } },
      { $or: [{ paidLeagues: { $exists: false } }, { paidLeagues: { $size: 0 } }] }
    ]
  }); // Usuário sem pagamento em qualquer liga
  
  return {
    totalUsers,
    bcryptUsers,
    cryptoUsers,
    unpaidUsers,
    lockedUsers: await this.countDocuments({ lockUntil: { $gt: new Date() } }),
    paidPercentage: (((totalUsers - unpaidUsers) / totalUsers) * 100).toFixed(1)
  };
};

userSchema.index({ email: 1 });
userSchema.index({ lockUntil: 1 });
userSchema.index({ hasPaid: 1 });
userSchema.index({ paidLeagues: 1 });

module.exports = mongoose.model('User', userSchema);
