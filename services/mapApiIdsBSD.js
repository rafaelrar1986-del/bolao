const axios = require('axios');

const API_KEY = process.env.API_FOOTBALL_KEY;

async function testGame() {
  const res = await axios.get(
    'https://sports.bzzoiro.com/api/events/8287/',
    {
      headers: {
        Authorization: `Token ${API_KEY}`
      }
    }
  );

  console.log(res.data);
}

testGame();
