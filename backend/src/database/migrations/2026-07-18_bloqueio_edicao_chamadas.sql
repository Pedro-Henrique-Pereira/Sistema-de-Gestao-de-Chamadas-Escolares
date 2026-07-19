USE Sistema_Chamada;

SET @sql = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'configuracoes_escola'
      AND COLUMN_NAME = 'bloquear_edicao_chamadas_apos_horario'
  ),
  'SELECT 1',
  'ALTER TABLE configuracoes_escola ADD COLUMN bloquear_edicao_chamadas_apos_horario BOOLEAN NOT NULL DEFAULT TRUE AFTER tempo_maximo_justificativas_meses'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE configuracoes_escola
SET bloquear_edicao_chamadas_apos_horario = TRUE
WHERE bloquear_edicao_chamadas_apos_horario IS NULL;

ALTER TABLE configuracoes_escola
  MODIFY COLUMN bloquear_edicao_chamadas_apos_horario BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS configuracoes_escola_auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  configuracao_id INT NOT NULL,
  alterado_por_id INT NULL,
  alterado_por_perfil VARCHAR(30) NOT NULL,
  campo VARCHAR(100) NOT NULL,
  valor_anterior VARCHAR(50) NULL,
  valor_novo VARCHAR(50) NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_config_auditoria_data (configuracao_id, criado_em),
  KEY idx_config_auditoria_usuario_data (alterado_por_id, criado_em),
  CONSTRAINT fk_config_auditoria_configuracao
    FOREIGN KEY (configuracao_id)
    REFERENCES configuracoes_escola(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_config_auditoria_usuario
    FOREIGN KEY (alterado_por_id)
    REFERENCES usuarios(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
