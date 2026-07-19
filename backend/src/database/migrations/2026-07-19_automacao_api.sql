USE Sistema_Chamada;

CREATE TABLE IF NOT EXISTS automacao_entregas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  fila_automacao_id INT NOT NULL,
  chave_idempotencia VARCHAR(100) NOT NULL,
  tipo_destino ENUM('responsavel', 'grupo') NOT NULL,
  aluno_id INT NULL,
  frequencia_aluno_id INT NULL,
  responsavel_id INT NULL,
  grupo_whatsapp_id INT NULL,
  data_referencia DATE NULL,
  status ENUM('pendente', 'processando', 'enviado', 'erro', 'cancelado', 'ignorado')
    NOT NULL DEFAULT 'pendente',
  tentativas TINYINT UNSIGNED NOT NULL DEFAULT 0,
  lock_owner VARCHAR(100) NULL,
  lock_adquirido_em DATETIME NULL,
  erro_codigo VARCHAR(80) NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  iniciado_em DATETIME NULL,
  concluido_em DATETIME NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_automacao_entregas_idempotencia (chave_idempotencia),
  KEY idx_automacao_entregas_fila_status (fila_automacao_id, status, tentativas, id),
  KEY idx_automacao_entregas_lock (status, lock_adquirido_em),
  KEY idx_automacao_entregas_aluno_data (aluno_id, data_referencia),
  CONSTRAINT fk_automacao_entregas_fila
    FOREIGN KEY (fila_automacao_id)
    REFERENCES fila_automacao(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_entregas_aluno
    FOREIGN KEY (aluno_id)
    REFERENCES alunos(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_entregas_frequencia
    FOREIGN KEY (frequencia_aluno_id)
    REFERENCES registros_frequencia_alunos(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_entregas_responsavel
    FOREIGN KEY (responsavel_id)
    REFERENCES responsaveis(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_entregas_grupo
    FOREIGN KEY (grupo_whatsapp_id)
    REFERENCES grupos_whatsapp(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT chk_automacao_entregas_tentativas
    CHECK (tentativas <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
