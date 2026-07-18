USE Sistema_Chamada;

SET @sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chamadas_diarias' AND COLUMN_NAME = 'confirmada_por_id'),
  'SELECT 1',
  'ALTER TABLE chamadas_diarias ADD COLUMN confirmada_por_id INT NULL AFTER status'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chamadas_diarias' AND COLUMN_NAME = 'confirmado_em'),
  'SELECT 1',
  'ALTER TABLE chamadas_diarias ADD COLUMN confirmado_em DATETIME NULL AFTER confirmada_por_id'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chamadas_diarias' AND COLUMN_NAME = 'bloqueada_em'),
  'SELECT 1',
  'ALTER TABLE chamadas_diarias ADD COLUMN bloqueada_em DATETIME NULL AFTER confirmado_em'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chamadas_diarias' AND COLUMN_NAME = 'versao'),
  'SELECT 1',
  'ALTER TABLE chamadas_diarias ADD COLUMN versao INT NOT NULL DEFAULT 1 AFTER bloqueada_em'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registros_frequencia_alunos' AND COLUMN_NAME = 'atraso_minutos'),
  'SELECT 1',
  'ALTER TABLE registros_frequencia_alunos ADD COLUMN atraso_minutos INT NULL AFTER atraso_registrado_em'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registros_frequencia_alunos' AND COLUMN_NAME = 'alterado_por_id'),
  'SELECT 1',
  'ALTER TABLE registros_frequencia_alunos ADD COLUMN alterado_por_id INT NULL AFTER atraso_minutos'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registros_frequencia_alunos' AND COLUMN_NAME = 'atualizado_em'),
  'SELECT 1',
  'ALTER TABLE registros_frequencia_alunos ADD COLUMN atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER alterado_por_id'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'justificativas_frequencia' AND COLUMN_NAME = 'atualizado_em'),
  'SELECT 1',
  'ALTER TABLE justificativas_frequencia ADD COLUMN atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER registrada_em'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS chamada_auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  chamada_id INT NOT NULL,
  usuario_id INT NULL,
  usuario_perfil VARCHAR(30) NOT NULL,
  evento ENUM(
    'CHAMADA_CRIADA',
    'CHAMADA_EDITADA_PELO_PROFESSOR',
    'CHAMADA_EDITADA_PELA_PEDAGOGIA',
    'ALUNO_MARCADO_COMO_ATRASADO',
    'JUSTIFICATIVA_ADICIONADA',
    'CHAMADA_CONFIRMADA',
    'EDICAO_BLOQUEADA_POR_HORARIO'
  ) NOT NULL,
  valores_anteriores JSON NULL,
  valores_novos JSON NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chamada_auditoria_chamada_data (chamada_id, criado_em),
  KEY idx_chamada_auditoria_usuario_data (usuario_id, criado_em),
  CONSTRAINT fk_chamada_auditoria_chamada FOREIGN KEY (chamada_id) REFERENCES chamadas_diarias(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_chamada_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'chamadas_diarias' AND CONSTRAINT_NAME = 'fk_chamadas_confirmada_por'),
  'SELECT 1',
  'ALTER TABLE chamadas_diarias ADD CONSTRAINT fk_chamadas_confirmada_por FOREIGN KEY (confirmada_por_id) REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'registros_frequencia_alunos' AND CONSTRAINT_NAME = 'fk_freq_alterado_por'),
  'SELECT 1',
  'ALTER TABLE registros_frequencia_alunos ADD CONSTRAINT fk_freq_alterado_por FOREIGN KEY (alterado_por_id) REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE chamadas_diarias cd
LEFT JOIN registros_chamadas_confirmadas rcc ON rcc.chamada_diaria_id_origem = cd.id
SET cd.confirmada_por_id = COALESCE(cd.confirmada_por_id, rcc.pedagoga_id),
    cd.confirmado_em = COALESCE(cd.confirmado_em, rcc.confirmado_em)
WHERE cd.status = 'confirmada';
