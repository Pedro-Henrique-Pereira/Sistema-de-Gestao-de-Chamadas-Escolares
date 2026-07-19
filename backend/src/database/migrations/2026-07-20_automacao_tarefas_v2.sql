USE Sistema_Chamada;

CREATE TABLE IF NOT EXISTS automacao_maquinas (
  maquina_id TINYINT NOT NULL PRIMARY KEY,
  identidade VARCHAR(30) NOT NULL,
  nome_exibicao VARCHAR(60) NOT NULL,
  habilitada BOOLEAN NOT NULL DEFAULT TRUE,
  estado ENUM(
    'online_available',
    'online_busy',
    'online_error',
    'offline',
    'updating',
    'disabled'
  ) NOT NULL DEFAULT 'offline',
  ultima_comunicacao_em DATETIME NULL,
  versao_aplicativo VARCHAR(30) NULL,
  versao_minima VARCHAR(30) NOT NULL DEFAULT '2.0.0',
  tarefa_atual_id INT NULL,
  worker_id VARCHAR(80) NULL,
  ultimo_erro_codigo VARCHAR(80) NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_automacao_maquinas_identidade (identidade),
  KEY idx_automacao_maquinas_estado_heartbeat (estado, ultima_comunicacao_em),
  CONSTRAINT chk_automacao_maquinas_id CHECK (maquina_id BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO automacao_maquinas
  (maquina_id, identidade, nome_exibicao, habilitada, estado)
VALUES
  (1, 'machine-1', 'Máquina 1', TRUE, 'offline'),
  (2, 'machine-2', 'Máquina 2', TRUE, 'offline'),
  (3, 'machine-3', 'Máquina 3', TRUE, 'offline'),
  (4, 'machine-4', 'Máquina 4', TRUE, 'offline'),
  (5, 'machine-5', 'Máquina 5', TRUE, 'offline')
ON DUPLICATE KEY UPDATE
  identidade = VALUES(identidade),
  nome_exibicao = VALUES(nome_exibicao);

CREATE TABLE IF NOT EXISTS automacao_eventos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  fila_automacao_id INT NOT NULL,
  automacao_entrega_id BIGINT NULL,
  evento_tipo VARCHAR(60) NOT NULL,
  status VARCHAR(40) NULL,
  erro_codigo VARCHAR(80) NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_automacao_eventos_tarefa_data (fila_automacao_id, criado_em, id),
  KEY idx_automacao_eventos_entrega_data (automacao_entrega_id, criado_em, id),
  CONSTRAINT fk_automacao_eventos_tarefa
    FOREIGN KEY (fila_automacao_id)
    REFERENCES fila_automacao(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_eventos_entrega
    FOREIGN KEY (automacao_entrega_id)
    REFERENCES automacao_entregas(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
