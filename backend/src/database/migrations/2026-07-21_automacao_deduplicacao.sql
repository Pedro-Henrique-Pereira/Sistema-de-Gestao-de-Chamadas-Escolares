CREATE TABLE IF NOT EXISTS automacao_deduplicacao (
  chave_deduplicacao CHAR(64) NOT NULL,
  tipo_notificacao VARCHAR(40) NOT NULL,
  aluno_id INT NOT NULL,
  responsavel_id INT NULL,
  data_referencia DATE NOT NULL,
  automacao_entrega_id BIGINT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (chave_deduplicacao),
  KEY idx_automacao_dedup_aluno_data (aluno_id, data_referencia),
  KEY idx_automacao_dedup_responsavel_data (responsavel_id, data_referencia),
  KEY idx_automacao_dedup_entrega (automacao_entrega_id),
  CONSTRAINT fk_automacao_dedup_aluno
    FOREIGN KEY (aluno_id)
    REFERENCES alunos(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_dedup_responsavel
    FOREIGN KEY (responsavel_id)
    REFERENCES responsaveis(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_dedup_entrega
    FOREIGN KEY (automacao_entrega_id)
    REFERENCES automacao_entregas(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO automacao_deduplicacao (
  chave_deduplicacao,
  tipo_notificacao,
  aluno_id,
  responsavel_id,
  data_referencia,
  automacao_entrega_id
)
SELECT
  SHA2(
    CONCAT(
      'absence:',
      DATE_FORMAT(delivery.data_referencia, '%Y-%m-%d'),
      ':student:',
      delivery.aluno_id,
      ':recipient:',
      IF(
        delivery.responsavel_id IS NOT NULL,
        CONCAT('guardian:', delivery.responsavel_id),
        CONCAT('phone:', delivery.telefone_destino)
      )
    ),
    256
  ),
  'absence_notification',
  delivery.aluno_id,
  delivery.responsavel_id,
  delivery.data_referencia,
  delivery.id
FROM automacao_entregas delivery
INNER JOIN fila_automacao task
  ON task.id = delivery.fila_automacao_id
WHERE task.tipo_automacao = 'faltas'
  AND delivery.tipo_destino = 'responsavel'
  AND delivery.aluno_id IS NOT NULL
  AND delivery.data_referencia IS NOT NULL
  AND (delivery.responsavel_id IS NOT NULL OR delivery.telefone_destino IS NOT NULL)
  AND delivery.status IN ('pendente', 'processando', 'enviado')
ORDER BY
  CASE delivery.status
    WHEN 'enviado' THEN 0
    WHEN 'processando' THEN 1
    ELSE 2
  END,
  delivery.id DESC;
