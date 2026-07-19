CREATE TABLE IF NOT EXISTS recuperacoes_senha (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expira_em DATETIME NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  utilizado_em DATETIME NULL,
  invalidado_em DATETIME NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_recuperacoes_senha_token_hash (token_hash),
  KEY idx_recuperacoes_senha_usuario_estado (
    usuario_id,
    utilizado_em,
    invalidado_em,
    expira_em
  ),
  KEY idx_recuperacoes_senha_expiracao (expira_em),
  CONSTRAINT fk_recuperacoes_senha_usuario
    FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
