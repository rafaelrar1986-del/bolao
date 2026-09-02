'use strict';

// O antigo roteiro dependia de métodos removidos do pointsService e, por isso,
// era um falso indicador de saúde do projeto. O conjunto de testes atual fica
// em tests/strategy-dynamic.test.js e usa exclusivamente a API vigente.
require('./tests/strategy-dynamic.test');
