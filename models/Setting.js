const mongoose = require('mongoose');

const SettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

SettingSchema.statics.get = async function(key, defaultValue=null) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : defaultValue;
};

SettingSchema.statics.set = async function(key, value) {
  const existing = await this.findOne({ key });
  if (existing) {
    existing.value = value;
    await existing.save();
    return existing;
  }
  return this.create({ key, value });
};

module.exports = mongoose.models.Setting || mongoose.model('Setting', SettingSchema);
