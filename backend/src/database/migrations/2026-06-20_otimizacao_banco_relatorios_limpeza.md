# Migracao: otimizacao de banco para relatorios, dashboards e limpeza operacional

Data: 2026-06-20  
Escopo: MySQL/Railway  
Objetivo: reduzir custo de CPU/IO nas consultas mais usadas sem alterar regras de negocio, sem remover historico confirmado e sem mudar a estrutura funcional das tabelas.

## Resumo executivo

Esta migracao adiciona indices complementares para:

- dashboards diarios de administracao e pedagogas;
- relatorios agregados por periodo;
- exportacao Excel filtrada por data/turma/aluno;
- listagens paginadas de alunos e responsaveis;
- limpeza de sessoes, chamadas pendentes antigas, controle de envios e fila de automacao.

Nao remove tabelas, colunas ou dados historicos escolares confirmados.

## Premissas de integridade

- Executar primeiro em ambiente de homologacao ou fora do horario escolar.
- Fazer backup/snapshot do banco antes da execucao no Railway.
- Nao executar comandos `DROP INDEX` nesta etapa. Existem indices redundantes, mas a remocao exige validacao com `EXPLAIN ANALYZE` em dados reais.
- A limpeza proposta remove apenas dados transitorios/operacionais vencidos.
- Historico confirmado em `registros_chamadas_confirmadas` e `registros_frequencia_alunos` deve ser preservado.

## SQL de aplicacao

> Executar no banco `Sistema_Chamada`.
> Copie somente o conteudo dentro do bloco `sql`. Nao cole as linhas com crases ``` nem os titulos Markdown no MySQL.

```sql
USE Sistema_Chamada;

-- 1. Consultas de dashboard e relatorios por data confirmada.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE registros_chamadas_confirmadas ADD INDEX idx_rcc_data_id (data_chamada, id)',
    'SELECT "idx_rcc_data_id ja existe"')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'registros_chamadas_confirmadas'
    AND INDEX_NAME = 'idx_rcc_data_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Agregacoes de graficos por periodo, status e atraso.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE registros_frequencia_alunos ADD INDEX idx_rfa_data_status_atraso (data_chamada, status, atrasado)',
    'SELECT "idx_rfa_data_status_atraso ja existe"')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'registros_frequencia_alunos'
    AND INDEX_NAME = 'idx_rfa_data_status_atraso'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Exportacao Excel filtrada por data e aluno.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE registros_frequencia_alunos ADD INDEX idx_rfa_data_aluno (data_chamada, aluno_id)',
    'SELECT "idx_rfa_data_aluno ja existe"')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'registros_frequencia_alunos'
    AND INDEX_NAME = 'idx_rfa_data_aluno'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. Exportacao Excel filtrada por data e turma.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE registros_frequencia_alunos ADD INDEX idx_rfa_data_turma (data_chamada, turma_id)',
    'SELECT "idx_rfa_data_turma ja existe"')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'registros_frequencia_alunos'
    AND INDEX_NAME = 'idx_rfa_data_turma'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. Join de justificativas por frequencia na exportacao e nos detalhes de chamada.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE justificativas_frequencia ADD INDEX idx_jf_freq_aluno (frequencia_aluno_id, aluno_id)',
    'SELECT "idx_jf_freq_aluno ja existe"')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'justificativas_frequencia'
    AND INDEX_NAME = 'idx_jf_freq_aluno'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6. Chamadas pendentes do dia: tela da pedagoga e confirmacao.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE chamadas_diarias ADD INDEX idx_cd_data_status_horario (data_chamada, status, horario_chamada, id)',
    'SELECT "idx_cd_data_status_horario ja existe"')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'chamadas_diarias'
    AND INDEX_NAME = 'idx_cd_data_status_horario'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7. Listagem paginada de alunos por turma e nome.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE alunos ADD INDEX idx_alunos_turma_nome (turma_id, nome, id)',
    'SELECT "idx_alunos_turma_nome ja existe"')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'alunos'
    AND INDEX_NAME = 'idx_alunos_turma_nome'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 8. Listagem de equipe por perfil, status e nome.
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE usuarios ADD INDEX idx_usuarios_tipo_ativo_nome (tipo, ativo, nome, id)',
    'SELECT "idx_usuarios_tipo_ativo_nome ja existe"')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'usuarios'
    AND INDEX_NAME = 'idx_usuarios_tipo_ativo_nome'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 9. Sessoes expiradas: dado operacional sem valor historico.
DELETE FROM sessoes_ativas
WHERE expira_em <= NOW();

-- 10. Controle diario de mensagens: preserva somente o dia atual.
DELETE FROM controle_envios_diarios
WHERE data_envio < CURDATE();

-- 11. Chamadas pendentes/canceladas antigas: preserva chamadas confirmadas ja migradas para historico.
DELETE FROM chamadas_diarias
WHERE data_chamada < CURDATE()
  AND status IN ('pendente', 'cancelada', 'confirmada');

-- 12. Fila de automacao finalizada antiga: dado operacional.
DELETE FROM fila_automacao
WHERE status IN ('concluido', 'erro', 'expirado', 'cancelado')
  AND data_solicitacao < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- 13. Expira tarefas pendentes antigas sem apagar imediatamente.
UPDATE fila_automacao
SET status = 'expirado',
    erro = COALESCE(erro, 'Tarefa expirada automaticamente por ficar pendente por mais de 7 dias.')
WHERE status = 'pendente'
  AND data_solicitacao < DATE_SUB(NOW(), INTERVAL 7 DAY);

-- 14. Libera locks travados.
UPDATE fila_automacao
SET status = 'pendente',
    lock_owner = NULL,
    lock_adquirido_em = NULL,
    iniciado_em = NULL,
    erro = COALESCE(erro, 'Lock liberado automaticamente por inatividade superior a 30 minutos.')
WHERE status = 'executando'
  AND lock_adquirido_em < DATE_SUB(NOW(), INTERVAL 30 MINUTE);
```

## Validacoes pos-aplicacao

Copie somente os comandos SQL abaixo. Nao copie o titulo desta secao nem as linhas com crases.

```sql
SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS colunas
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND INDEX_NAME IN (
    'idx_rcc_data_id',
    'idx_rfa_data_status_atraso',
    'idx_rfa_data_aluno',
    'idx_rfa_data_turma',
    'idx_jf_freq_aluno',
    'idx_cd_data_status_horario',
    'idx_alunos_turma_nome',
    'idx_usuarios_tipo_ativo_nome'
  )
GROUP BY TABLE_NAME, INDEX_NAME
ORDER BY TABLE_NAME, INDEX_NAME;
```

```sql

EXPLAIN
SELECT
  COALESCE(SUM(CASE WHEN LOWER(COALESCE(rfa.status, '')) IN ('presente', 'atrasado') THEN 1 ELSE 0 END), 0) AS presentes,
  COALESCE(SUM(CASE WHEN LOWER(COALESCE(rfa.status, '')) IN ('ausente', 'falta', 'faltou', 'justificado') THEN 1 ELSE 0 END), 0) AS ausentes,
  COALESCE(SUM(CASE WHEN LOWER(COALESCE(rfa.status, '')) = 'justificado' THEN 1 ELSE 0 END), 0) AS justificados,
  COALESCE(SUM(CASE WHEN (rfa.atrasado = TRUE OR LOWER(COALESCE(rfa.status, '')) = 'atrasado') THEN 1 ELSE 0 END), 0) AS atrasos,
  COUNT(DISTINCT rfa.registro_chamada_id) AS chamadas
FROM registros_frequencia_alunos rfa
WHERE rfa.data_chamada >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)
  AND rfa.data_chamada < DATE_ADD(CURDATE(), INTERVAL 1 DAY);
```

```sql

EXPLAIN
SELECT id, professor_id, professor_nome, turma_id, turma_nome, materia,
       data_chamada, horario_chamada, alunos, total_presentes, total_ausentes, status
FROM chamadas_diarias
WHERE data_chamada = CURDATE()
  AND status = 'pendente'
ORDER BY horario_chamada DESC, id DESC;
```

## Rollback

Usar rollback somente se houver regressao comprovada por `EXPLAIN`, tempo de resposta ou erro de aplicacao. Nao ha rollback para os `DELETE/UPDATE` operacionais; por isso o backup antes da aplicacao e obrigatorio.

```sql
USE Sistema_Chamada;

ALTER TABLE registros_chamadas_confirmadas DROP INDEX idx_rcc_data_id;
ALTER TABLE registros_frequencia_alunos DROP INDEX idx_rfa_data_status_atraso;
ALTER TABLE registros_frequencia_alunos DROP INDEX idx_rfa_data_aluno;
ALTER TABLE registros_frequencia_alunos DROP INDEX idx_rfa_data_turma;
ALTER TABLE chamadas_diarias DROP INDEX idx_cd_data_status_horario;
ALTER TABLE alunos DROP INDEX idx_alunos_turma_nome;
ALTER TABLE usuarios DROP INDEX idx_usuarios_tipo_ativo_nome;

-- Este indice pode estar sendo usado pela FK fk_just_freq.
-- Se o MySQL retornar Error Code 1553, mantenha o indice.
-- Para remover mesmo assim, crie antes um indice substituto com frequencia_aluno_id como primeira coluna.
ALTER TABLE justificativas_frequencia ADD INDEX idx_jf_frequencia_aluno_id (frequencia_aluno_id);
ALTER TABLE justificativas_frequencia DROP INDEX idx_jf_freq_aluno;
```

## Observacoes tecnicas

- Campos de pesquisa com `LIKE '%termo%'` e `LOWER(...)` continuam limitados para uso de indice B-tree. A mitigacao principal ja aplicada no frontend e o debounce/minimo de caracteres. Para ganho maior, avaliar em etapa futura colunas normalizadas ou full-text, com ajuste de codigo e testes.
- Nao foi proposta exclusao de indices redundantes nesta migracao para preservar estabilidade. Candidatos a revisao futura: pares de indices com mesmas colunas iniciais em `registros_frequencia_alunos` e `registros_chamadas_confirmadas`.
- `justificativas_frequencia.motivo` e dados de alunos/funcionarios sao historicos sensiveis; nao devem ser limpos fora das regras de retencao configuradas.
- `chamadas_diarias` armazena fila diaria/transitoria; o historico confiavel fica em `registros_chamadas_confirmadas` e `registros_frequencia_alunos`.
