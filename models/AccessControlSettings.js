const mongoose = require('mongoose');

const AccessControlSettingsSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: 'global'
    },
    requireWhitelist: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    collection: 'accessControlSettings'
  }
);

module.exports = mongoose.model(
  'AccessControlSettings',
  AccessControlSettingsSchema
);
