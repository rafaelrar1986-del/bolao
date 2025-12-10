const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  blockSaveBets: { type: Boolean, default: false },
  blockSaveKnockout: { type: Boolean, default: false },
  requireAllGroupBets: { type: Boolean, default: false },
}, { timestamps: true });

// Garante singleton
settingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({});
  if (!doc) doc = await this.create({});
  return doc;
};

module.exports = mongoose.model('Settings', settingsSchema);
