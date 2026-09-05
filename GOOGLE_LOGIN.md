# Login com Google

O login por email e senha permanece inalterado. A rota adicional `POST /api/auth/google` recebe um ID token emitido pelo Google Identity Services, valida a audiência e o email no servidor e então emite o mesmo JWT usado pelo restante do bolão.

## Configuração

Configure `GOOGLE_CLIENT_ID` no ambiente do backend e adicione os domínios do frontend como origens JavaScript autorizadas no cliente OAuth do Google.

Novos usuários continuam sujeitos à coleção `AllowedEmail`. Quando o email Google já existe, a conta é vinculada pelo email verificado e mantém as ligas, pagamentos, permissões e histórico existentes.

## Publicação

O preview do workspace continua usando o proxy local para a API publicada. Depois de publicar este backend atualizado, a rota `GET /api/auth/google-config` passa a habilitar o botão Google no frontend e a rota `POST /api/auth/google` conclui o login.