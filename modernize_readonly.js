const fs = require('fs');
let file = 'js/matches/matchesGroupPrediction.js';
let content = fs.readFileSync(file, 'utf8');

const oldStyle = `group-prediction-position-readonly" style="width:100%;min-width:0;padding:4px 8px;height:36px;border-radius:8px;background:rgba(0,5,10,0.6);border:1px solid rgba(0,255,255,0.3);color:#e0f7fa;font-weight:600;display:flex;align-items:center;gap:4px;box-shadow:inset 0 0 10px rgba(0,255,255,0.05);box-sizing:border-box;">`;
const newStyle = `group-prediction-position-readonly" style="width:100%;min-width:0;padding:6px 12px;height:40px;border-radius:6px;background:linear-gradient(90deg, rgba(0,255,255,0.05) 0%, rgba(0,0,0,0.2) 100%);border-left:3px solid rgba(0, 255, 255, 0.6);border-top:1px solid rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.03);border-right:1px solid rgba(255,255,255,0.03);color:#ffffff;font-weight:700;letter-spacing:0.3px;display:flex;align-items:center;gap:10px;box-sizing:border-box;box-shadow:inset 20px 0 30px -20px rgba(0,255,255,0.1);">`;

const oldSpan = `<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px;margin-left:4px;">`;
const newSpan = `<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px;text-shadow: 0 0 5px rgba(255,255,255,0.2);">`;

content = content.replace(oldStyle, newStyle);
content = content.replace(oldSpan, newSpan);

fs.writeFileSync(file, content, 'utf8');
console.log('Applied modern styling to readonly predictions');
