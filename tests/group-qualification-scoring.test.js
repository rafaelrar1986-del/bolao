
'use strict';
const assert = require('assert');
const { calculateGroupQualificationPoints } = require('../services/pointsService');

const rules = {
  groupQualificationRules: [
    { points: 3, conditions: ['positionCorrect','teamQualified'] },
    { points: 2, conditions: ['positionIncorrect','teamQualified'] },
    { points: 1, conditions: ['positionCorrect','teamNotQualified'] }
  ]
};

const championshipRules = {
  groupQualification: { totalTeams: 48, groupCount: 12, totalQualified: 32 }
};

const matches = [
  { phase:'group', group:'A', teamA:'Brasil', teamB:'Argentina', scoreA:2, scoreB:0, status:'finished' },
  { phase:'group', group:'A', teamA:'Japão', teamB:'Canadá', scoreA:1, scoreB:0, status:'finished' },
  { phase:'group', group:'A', teamA:'Brasil', teamB:'Japão', scoreA:1, scoreB:1, status:'finished' },
  { phase:'group', group:'A', teamA:'Argentina', teamB:'Canadá', scoreA:2, scoreB:0, status:'finished' },
  { phase:'group', group:'A', teamA:'Brasil', teamB:'Canadá', scoreA:1, scoreB:0, status:'finished' },
  { phase:'group', group:'A', teamA:'Argentina', teamB:'Japão', scoreA:0, scoreB:0, status:'finished' }
];

// Real: Brasil 1º, Argentina 2º, Japão 3º, Canadá 4º.
// In this generic 48/12/32 format the 3rd is an additional qualifier.
// Predict: Brasil 1º, Japão 2º, Argentina 3º, Canadá 4º; choose Japão as additional qualifier.
// Brasil: 3; Japão: 2; Argentina: 2; Canadá: 1 => 8.
const prediction = [{
  group:'A',
  positions:[
    {position:1,team:'Brasil'},
    {position:2,team:'Japão'},
    {position:3,team:'Argentina'},
    {position:4,team:'Canadá'}
  ],
  additionalQualifiedTeams:['Argentina'] // predicted 3rd advances
}];

const result = calculateGroupQualificationPoints(prediction,matches,rules,championshipRules,false);
assert.strictEqual(result.points, 10);
assert.deepStrictEqual(result.byGroup,[{group:'A',points:10}]);

const wrongThirdPrediction = [{
  group:'A',
  positions:[
    {position:1,team:'Brasil'},
    {position:2,team:'Japão'},
    {position:3,team:'Argentina'},
    {position:4,team:'Canadá'}
  ],
  additionalQualifiedTeams:['Japão']
}];
const result2 = calculateGroupQualificationPoints(wrongThirdPrediction,matches,rules,championshipRules,false);
// Brasil +3; Japão +2 (qualified, wrong position); Argentina gets 0
// because the user predicted it as non-qualified; Canadá +1.
assert.strictEqual(result2.points, 7);
console.log('group-qualification-scoring.test.js: OK');
