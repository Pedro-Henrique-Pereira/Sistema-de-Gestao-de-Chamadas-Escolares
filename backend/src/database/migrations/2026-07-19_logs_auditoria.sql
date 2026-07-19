USE Sistema_Chamada;

CREATE TABLE IF NOT EXISTS logs_auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  acao_tipo VARCHAR(80) NOT NULL,
  descricao VARCHAR(500) NOT NULL,
  usuario_id INT NULL,
  usuario_nome VARCHAR(100) NOT NULL,
  usuario_perfil VARCHAR(30) NOT NULL,
  entidade_tipo VARCHAR(50) NOT NULL,
  entidade_id VARCHAR(64) NULL,
  resultado ENUM('sucesso', 'falha') NOT NULL,
  ip_origem VARCHAR(45) NULL,
  detalhes JSON NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_auditoria_data_id (criado_em, id),
  KEY idx_auditoria_acao_data (acao_tipo, criado_em),
  KEY idx_auditoria_usuario_nome_data (usuario_nome, criado_em),
  KEY idx_auditoria_perfil_data (usuario_perfil, criado_em),
  KEY idx_auditoria_resultado_data (resultado, criado_em),
  KEY idx_auditoria_entidade_data (entidade_tipo, criado_em),
  KEY idx_auditoria_entidade_id (entidade_tipo, entidade_id),
  CONSTRAINT fk_logs_auditoria_usuario
    FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditoria_limpeza_estado (
  id TINYINT PRIMARY KEY,
  ultima_execucao_em DATETIME NULL,
  ultima_quantidade_removida INT NOT NULL DEFAULT 0,
  proxima_execucao_em DATETIME NOT NULL,
  ultima_tentativa_em DATETIME NULL,
  em_execucao_desde DATETIME NULL,
  ultimo_erro VARCHAR(255) NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_auditoria_limpeza_id CHECK (id = 1),
  CONSTRAINT chk_auditoria_limpeza_quantidade CHECK (ultima_quantidade_removida >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO auditoria_limpeza_estado (
  id,
  ultima_execucao_em,
  ultima_quantidade_removida,
  proxima_execucao_em
)
VALUES (1, NULL, 0, NOW())
ON DUPLICATE KEY UPDATE id = id;
