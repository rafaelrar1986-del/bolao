const {getTieBreakerMetrics,compareBySportsRanking}=require('../services/rankingService');
const rows=[
{name:'A', totalPoints:100, m:{extraPoints:5,podiumPoints:1,exactScorePoints:99}},
{name:'B', totalPoints:100, m:{extraPoints:5,podiumPoints:2,exactScorePoints:1}},
{name:'C', totalPoints:100, m:{extraPoints:4,podiumPoints:99,exactScorePoints:99}}
].map(x=>({user:{name:x.name},totalPoints:x.totalPoints,tieBreakerMetrics:getTieBreakerMetrics({},x.m)}));
for(const a of rows)for(const b of rows)if(a!==b)console.log(a.user.name,b.user.name,compareBySportsRanking(a,b,['extraPoints','podiumPoints','exactScorePoints']),a.tieBreakerMetrics,b.tieBreakerMetrics);
