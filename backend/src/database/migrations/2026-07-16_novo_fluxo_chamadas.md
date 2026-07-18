# Novo fluxo de chamadas

Execute `2026-07-16_novo_fluxo_chamadas.sql` no banco `Sistema_Chamada` antes de publicar o backend.

A migration e idempotente para colunas, chaves e tabela de auditoria. Chamadas antigas confirmadas permanecem confirmadas e recebem, quando existente, a pedagoga e o horario a partir de `registros_chamadas_confirmadas`. Nenhuma chamada antiga e convertida para temporaria.

## Rollback

O rollback e deliberadamente conservador: mantenha as novas colunas e a tabela de auditoria caso o codigo precise ser revertido, pois remove-las descartaria historico. Depois de reverter o backend, elas permanecem inertes e compativeis com a versao anterior.
