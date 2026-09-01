const mongoose = require('mongoose');

const BetReceiptSchema = new mongoose.Schema({
  protocol: { type: String, required: true, unique: true, index: true, trim: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  leagueId: { type: String, required: true, index: true },
  bet: { type: mongoose.Schema.Types.ObjectId, ref: 'Bet', required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  operation: {
    type: String,
    enum: ['initial_save', 'save', 'edit'],
    default: 'save'
  },
  createdAt: { type: Date, default: Date.now, index: true },
  isCurrent: { type: Boolean, default: true, index: true },
  supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'BetReceipt', default: null },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  snapshotHash: { type: String, required: true, index: true },
  email: {
    attemptedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    messageId: { type: String, default: null },
    error: { type: String, default: null }
  }
}, { timestamps: true });

BetReceiptSchema.index({ user: 1, leagueId: 1, version: -1 });
BetReceiptSchema.index({ bet: 1, version: -1 });

module.exports =
  mongoose.models.BetReceipt ||
  mongoose.model('BetReceipt', BetReceiptSchema);
