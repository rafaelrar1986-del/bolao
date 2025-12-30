// routes/users.js
const express = require('express');
const User = require('../models/User');
const Bet = require('../models/Bet');
const { protect } = require('../middleware/auth');

const router = express.Router();
