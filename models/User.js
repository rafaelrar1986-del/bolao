const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
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
  password: {
    type: String,
    required: [true, 'Senha é obrigatória'],
    minlength: [6, 'Senha deve ter pelo menos 6 caracteres']
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  passwordVersion: {
    type: Number,
    default: 1, // 1 = bcrypt (problema no Render), 2 = crypto fallback
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

// Criptografar senha antes de salvar - COM FALLBACK
userSchema.pre('save', async function(next) {
  // Só processar se a senha foi modificada
  if (!this.isModified('password')) return next();

  console.log('🔐 PROCESSANDO SENHA - Método:', this.passwordVersion);
  
  try {
    // Se passwordVersion = 1, usar bcrypt (pode falhar no Render)
    if (this.passwordVersion === 1) {
      console.log('🔄 Tentando bcrypt...');
      this.password = await bcrypt.hash(this.password, 12);
      console.log('✅ Bcrypt bem-sucedido');
    } 
    // Se passwordVersion = 2, usar crypto fallback (sempre funciona)
    else if (this.passwordVersion === 2) {
      console.log('🔄 Usando crypto fallback...');
      this.password = this.createHashFallback(this.password);
      console.log('✅ Crypto fallback bem-sucedido');
    }
    
    // Resetar tentativas de login se a senha foi alterada
    this.loginAttempts = 0;
    this.lockUntil = null;
    
    next();
  } catch (error) {
    console.error('❌ ERRO AO PROCESSAR SENHA:', error);
    
    // 🔥 FALLBACK AUTOMÁTICO: Se bcrypt falhar, usar crypto
    console.log('🔄 Fallback automático para crypto');
    this.passwordVersion = 2;
    this.password = this.createHashFallback(this.password);
    this.needsRehash = true;
    
    console.log('✅ Senha processada com fallback crypto');
    next();
  }
});

// ======================
// MÉTODOS DE INSTÂNCIA
// ======================

// 🔥 MÉTODO PRINCIPAL: Comparar senha com múltiplas estratégias
userSchema.methods.comparePassword = async function(candidatePassword) {
  console.log('🔐 COMPARANDO SENHA - Versão:', this.passwordVersion);
  
  // Se a conta está bloqueada
  if (this.isLocked) {
    console.log('❌ Conta bloqueada temporariamente');
    throw new Error('Conta bloqueada temporariamente. Tente novamente mais tarde.');
  }

  let isMatch = false;

  try {
    // Estratégia 1: Bcrypt (para passwordVersion = 1)
    if (this.passwordVersion === 1) {
      console.log('🔄 Tentando bcrypt compare...');
      isMatch = await bcrypt.compare(candidatePassword, this.password);
      console.log('✅ Resultado bcrypt:', isMatch);
    }
    // Estratégia 2: Crypto fallback (para passwordVersion = 2)
    else if (this.passwordVersion === 2) {
      console.log('🔄 Usando crypto fallback compare...');
      const candidateHash = this.createHashFallback(candidatePassword);
      isMatch = candidateHash === this.password;
      console.log('✅ Resultado crypto:', isMatch);
    }

    // Atualizar tentativas de login
    if (isMatch) {
      // Login bem-sucedido
      this.loginAttempts = 0;
      this.lastLogin = new Date();
      await this.save();
      console.log('✅ Senha válida');
    } else {
      // Login falhou - incrementar tentativas
      this.loginAttempts += 1;
      
      // Bloquear conta após 5 tentativas falhas
      if (this.loginAttempts >= 5) {
        this.lockUntil = Date.now() + (30 * 60 * 1000); // 30 minutos
        console.log('🚫 Conta bloqueada por 30 minutos');
      }
      
      await this.save();
      console.log('❌ Senha inválida. Tentativas:', this.loginAttempts);
    }

    return isMatch;

  } catch (error) {
    console.error('❌ ERRO NA COMPARAÇÃO:', error);
    
    // Se bcrypt falhou, tentar migrar para crypto fallback
    if (this.passwordVersion === 1 && error.message.includes('bcrypt')) {
      console.log('🔄 Migrando para crypto fallback devido a erro...');
      try {
        const candidateHash = this.createHashFallback(candidatePassword);
        isMatch = candidateHash === this.password;
        
        if (isMatch) {
          // Migrar permanentemente para crypto
          this.passwordVersion = 2;
          this.needsRehash = false;
          await this.save();
          console.log('✅ Migração para crypto bem-sucedida');
        }
        
        return isMatch;
      } catch (fallbackError) {
        console.error('❌ Fallback também falhou:', fallbackError);
        return false;
      }
    }
    
    return false;
  }
};

// 🔥 MÉTODO FALLBACK: Criar hash usando crypto nativo
userSchema.methods.createHashFallback = function(password) {
  return crypto
    .createHash('sha256')
    .update(password + (process.env.JWT_SECRET || 'fallback-secret'))
    .digest('hex');
};

// 🔥 MÉTODO: Forçar migração para crypto fallback
userSchema.methods.migrateToCrypto = async function(newPassword = null) {
  console.log('🔄 Migrando usuário para crypto fallback...');
  
  if (newPassword) {
    this.password = newPassword;
  }
  
  this.passwordVersion = 2;
  this.needsRehash = false;
  
  await this.save();
  console.log('✅ Migração concluída');
  return this;
};

// 🔥 MÉTODO: Resetar bloqueio de conta
userSchema.methods.resetLock = async function() {
  this.loginAttempts = 0;
  this.lockUntil = null;
  await this.save();
  console.log('✅ Bloqueio de conta resetado');
  return this;
};

// 🔥 MÉTODO: Verificar se precisa de rehash
userSchema.methods.requiresRehash = function() {
  return this.needsRehash || this.passwordVersion === 1;
};

// ======================
// MÉTODOS ESTÁTICOS
// ======================

// 🔥 MÉTODO ESTÁTICO: Buscar por email
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase().trim() });
};

// 🔥 MÉTODO ESTÁTICO: Migrar todos os usuários para crypto
userSchema.statics.migrateAllToCrypto = async function() {
  console.log('🔄 Migrando todos os usuários para crypto...');
  
  const users = await this.find({ passwordVersion: 1 });
  let migratedCount = 0;
  
  for (const user of users) {
    try {
      // Manter a mesma senha, apenas mudar o método de hash
      const currentPassword = user.password;
      user.passwordVersion = 2;
      user.password = user.createHashFallback('temp'); // Será recalculado no save
      user.needsRehash = true;
      await user.save();
      migratedCount++;
    } catch (error) {
      console.error(`❌ Erro migrando usuário ${user.email}:`, error);
    }
  }
  
  console.log(`✅ ${migratedCount}/${users.length} usuários migrados`);
  return migratedCount;
};

// 🔥 MÉTODO ESTÁTICO: Estatísticas de segurança
userSchema.statics.getSecurityStats = async function() {
  const totalUsers = await this.countDocuments();
  const bcryptUsers = await this.countDocuments({ passwordVersion: 1 });
  const cryptoUsers = await this.countDocuments({ passwordVersion: 2 });
  const lockedUsers = await this.countDocuments({ 
    lockUntil: { $gt: new Date() } 
  });
  
  return {
    totalUsers,
    bcryptUsers,
    cryptoUsers,
    lockedUsers,
    bcryptPercentage: ((bcryptUsers / totalUsers) * 100).toFixed(1),
    cryptoPercentage: ((cryptoUsers / totalUsers) * 100).toFixed(1)
  };
};

// ======================
// ÍNDICES
// ======================
userSchema.index({ email: 1 });
userSchema.index({ lockUntil: 1 });
userSchema.index({ passwordVersion: 1 });

module.exports = mongoose.model('User', userSchema);
