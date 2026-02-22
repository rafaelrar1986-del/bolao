const mongoose = require('mongoose');

const allowedEmailSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,     // Garante que não haja e-mails duplicados na lista
    lowercase: true,  // Salva sempre em minúsculo para evitar erros de busca
    trim: true
  },
  label: { 
    type: String,     // Um campo opcional para você saber de quem é o e-mail (ex: "Amigo João")
    trim: true 
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('AllowedEmail', allowedEmailSchema);
