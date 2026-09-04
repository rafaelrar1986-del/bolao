const mongoose = require('mongoose');

const LeagueSchema = new mongoose.Schema({
  leagueId: { type: String, required: true, unique: true, index: true, trim: true },
  name: { type: String, required: true, trim: true },
  source: { type: String, enum: ['manual', 'api'], default: 'manual', index: true },
  apiLeagueId: { type: Number, default: null },
  apiLeagueName: { type: String, default: '' },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

module.exports = mongoose.model('League', LeagueSchema);
