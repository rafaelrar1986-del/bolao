const Bet = require('../models/Bet');
const Match = require('../models/Match');
const fs = require('fs'); // Mantido para a validação de integridade do arquivo
const path = require('path');
const ExcelJS = require('exceljs'); // Nova biblioteca para gerar o Excel real

exports.generateAuditCSV = async (leagueId, groupName) => {
    console.log(`\n[DEBUG AUDITORIA] 🚀 Iniciando geração para Liga: ${leagueId}, Identificador: "${groupName}"`);

    try {
        // 1. Busca partidas - Filtra por Liga e por Grupo ou Fase (Idêntico ao original)
        const matchQuery = { 
            leagueId: Number(leagueId), 
            $or: [
                { group: groupName },
                { phaseName: groupName }
            ]
        };
        console.log(`[DEBUG AUDITORIA] 🔍 Buscando jogos com query:`, JSON.stringify(matchQuery));

        const matches = await Match.find(matchQuery).sort({ matchId: -1 }).lean();

        if (matches.length === 0) {
            console.error(`[DEBUG AUDITORIA] ❌ ERRO: Nenhuma partida encontrada no banco para "${groupName}".`);
            return null;
        }
        console.log(`[DEBUG AUDITORIA] ✅ ${matches.length} partidas encontradas.`);

        // 2. Busca apostas da liga específica (Idêntico ao original)
        console.log(`[DEBUG AUDITORIA] 🔍 Buscando apostas para leagueId: "${leagueId}"`);
        const allBets = await Bet.find({ leagueId: String(leagueId) })
            .populate('user', 'name email')
            .lean();

        console.log(`[DEBUG AUDITORIA] 📊 Total de documentos de aposta: ${allBets.length}`);

        // 3. Inicialização e configuração da planilha Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Auditoria');

        // Mapeia e define as colunas iniciais e os cabeçalhos dinâmicos dos jogos
        const columnsConfig = [
            { header: 'Participante', key: 'user_name', width: 28 }
        ];

        // Adiciona as colunas dos jogos dinamicamente
        matches.forEach(m => {
            columnsConfig.push({
                header: `${m.teamA} x ${m.teamB}`,
                key: `match_${m.matchId}`,
                width: 25 // Largura ideal para não cortar os nomes dos times e o "Passa: ..."
            });
        });

        // Adiciona as colunas estruturadas para o Pódio (Baseado no seu PodiumSchema)
        columnsConfig.push(
            { header: '1º Lugar (Campeão)', key: 'podium_1st', width: 22 },
            { header: '2º Lugar', key: 'podium_2nd', width: 22 },
            { header: '3º Lugar', key: 'podium_3rd', width: 22 },
            { header: '4º Lugar', key: 'podium_4th', width: 22 }
        );

        worksheet.columns = columnsConfig;

        // Estilização profissional do Cabeçalho (Linha 1)
        const headerRow = worksheet.getRow(1);
        headerRow.height = 25;
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: '1F4E78' } // Azul escuro corporativo
            };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        });

        // 4. Processamento das apostas dos usuários (Mantendo TODA a lógica interna original)
        let usersWithBetsCount = 0;
        allBets.forEach(bet => {
            if (!bet.user) return; // Ignora se não houver usuário vinculado

            // Objeto que guardará os valores desta linha na planilha
            const rowData = {
                user_name: bet.user.name,
                user_email: bet.user.email
            };
            
            // Processa os palpites de cada jogo do usuário
            matches.forEach(m => {
                // Localiza o palpite do usuário para esta partida específica
                const p = (bet.groupMatches || []).find(gm => String(gm.matchId) === String(m.matchId));
                
                if (!p) {
                    rowData[`match_${m.matchId}`] = "---";
                    return;
                }

                let infoResultado = "";

                // Converte 'A', 'B' ou 'draw' para o nome real do time ou "Empate" (Idêntico ao original)
                if (p.winner === 'A') {
                    infoResultado = m.teamA;
                } else if (p.winner === 'B') {
                    infoResultado = m.teamB;
                } else if (p.winner === 'draw' || p.winner === 'Empate') {
                    infoResultado = "Empate";
                }

                // Se houver informação de classificado (Mata-Mata), adicionamos ao texto (Idêntico ao original)
                if (p.qualifier) {
                    const nomeClassificado = p.qualifier === 'A' ? m.teamA : m.teamB;
                    rowData[`match_${m.matchId}`] = `${infoResultado} (Classificado: ${nomeClassificado})`;
                } else {
                    rowData[`match_${m.matchId}`] = infoResultado || "---";
                }
            });

            // Processa e injeta os dados do pódio (Garante fallback seguro caso esteja vazio)
            const podium = bet.podium || {};
            rowData.podium_1st = podium.first || "---";
            rowData.podium_2nd = podium.second || "---";
            rowData.podium_3rd = podium.third || "---";
            rowData.podium_4th = podium.fourth || "---";

            // Insere a linha preenchida na planilha
            const addedRow = worksheet.addRow(rowData);
            addedRow.height = 20;

            // Aplica alinhamento e bordas para simular o visual nativo do Excel
            addedRow.eachCell((cell, colNumber) => {
                if (colNumber > 2) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                } else {
                    cell.alignment = { horizontal: 'left', vertical: 'middle' };
                }
                cell.border = {
                    top: { style: 'thin', color: { argb: 'E0E0E0' } },
                    left: { style: 'thin', color: { argb: 'E0E0E0' } },
                    bottom: { style: 'thin', color: { argb: 'E0E0E0' } },
                    right: { style: 'thin', color: { argb: 'E0E0E0' } }
                };
            });

            usersWithBetsCount++;
        });

        console.log(`[DEBUG AUDITORIA] 📝 Planilha processada com ${usersWithBetsCount} participantes.`);

        // 5. Criação do arquivo físico no diretório temporário com a extensão .xlsx atualizada
        const safeName = groupName.replace(/\s/g, '_').replace(/[^\w]/gi, '');
        const fileName = `Auditoria_${safeName}.xlsx`; // Alterado de .csv para .xlsx
        const filePath = path.join('/tmp', fileName); 
        
        console.log(`[DEBUG AUDITORIA] 📂 Gravando arquivo em: ${filePath}`);
        
        // Grava o arquivo de forma assíncrona usando o exceljs
        await workbook.xlsx.writeFile(filePath);

        // Verificação de integridade (Mantido exatamente como o seu original)
        const stats = fs.statSync(filePath);
        console.log(`[DEBUG AUDITORIA] 📁 Arquivo criado. Tamanho: ${stats.size} bytes.`);

        return {
            path: filePath,
            originalname: fileName
        };

    } catch (error) {
        console.error(`[DEBUG AUDITORIA] 💥 FALHA CRÍTICA NO SERVICE:`, error);
        return null;
    }
};
