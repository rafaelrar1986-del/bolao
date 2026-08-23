# Testes funcionais automatizados

## Execução

- `npm run test:functional:save` — 16 cenários críticos do `/save`
- `npm run test:functional:lock` — 6 cenários do `betLockService`
- `npm run test:functional:critical` — executa os dois conjuntos

## Cobertura atual

### /save
- partida futura
- partida iniciada
- grade bloqueada
- reenvio idêntico
- alteração de aposta bloqueada
- nova aposta em grade bloqueada
- reenvio de grade antiga + nova grade aberta
- placar habilitado/desabilitado
- winner derivado/manual
- preservação de pódio
- pódio inválido
- matchId inválido
- partida de outra liga

### betLockService
- modo partida antes/no/depois do horário
- modo grade com fase bloqueada
- modo grade com fase aberta
- modo grade + partida iniciada
