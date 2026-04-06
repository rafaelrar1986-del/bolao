const express = require('express');
const router = express.Router();
const { getRanking } = require('../controllers/rankingController');
// Se você usa autenticação, importe o seu middleware aqui (ex: protect)
// const { protect } = require('../middleware/authMiddleware'); 

// Define a rota. O controller que te passei vai ler o ?type=partial daqui
router.get('/leaderboard', getRanking); 

module.exports = router;
