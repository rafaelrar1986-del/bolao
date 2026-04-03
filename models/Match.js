const MatchSchema = new Schema(
  {
    matchId: { type: Number, required: true, unique: true, index: true },

    teamA: { type: String, required: true, trim: true },
    teamB: { type: String, required: true, trim: true },

    group: { type: String, required: true, trim: true },

    phase: { type: String, enum: ['group','knockout'], default: 'group', index: true },

    qualifiedSide: { type: String, enum: ['A','B', null], default: null },

    stadium: { type: String, default: '', trim: true },

    date: { type: String, required: true, trim: true },
    time: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ['scheduled', 'in_progress', 'finished'],
      default: 'scheduled',
      index: true,
    },

    scoreA: { type: Number, default: null, min: 0 },
    scoreB: { type: Number, default: null, min: 0 },

    betsCount: { type: Number, default: 0 },

    // 🔥 AGORA SIM — CORRETO
    apiId: {
      type: Number,
      required: false,
      index: true
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);
