create database Sistema_Chamada;
use Sistema_Chamada;

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  tipo ENUM('professor', 'pedagoga', 'administracao') NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  maquina_padrao_chamadas TINYINT NULL,
  maquina_padrao_mensagens TINYINT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_usuarios_email (email),
  KEY idx_usuarios_email (email),
  KEY idx_usuarios_tipo_ativo (tipo, ativo),
  KEY idx_usuarios_maquina_padrao_chamadas (maquina_padrao_chamadas),
  KEY idx_usuarios_maquina_padrao_mensagens (maquina_padrao_mensagens),
  CONSTRAINT chk_usuarios_maquina_padrao_chamadas
    CHECK (maquina_padrao_chamadas IS NULL OR maquina_padrao_chamadas BETWEEN 1 AND 5),
  CONSTRAINT chk_usuarios_maquina_padrao_mensagens
    CHECK (maquina_padrao_mensagens IS NULL OR maquina_padrao_mensagens IN (3, 4, 5))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessoes_ativas (
  id CHAR(36) NOT NULL,
  usuario_id INT NOT NULL,
  token_id CHAR(36) NOT NULL,
  dispositivo_info TEXT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sessoes_ativas_token_id (token_id),
  KEY idx_sessoes_ativas_usuario_token (usuario_id, token_id),
  KEY idx_sessoes_ativas_expira_em (expira_em),
  CONSTRAINT fk_sessoes_ativas_usuario
    FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS turmas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(50) NOT NULL,
  criada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_turmas_nome (nome),
  KEY idx_turmas_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alunos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  idade INT NULL,
  sexo ENUM('masculino', 'feminino', 'outro', 'nao_informado') NULL,
  turma_id INT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_alunos_nome (nome),
  KEY idx_alunos_turma (turma_id),
  KEY idx_alunos_turma_ativo (turma_id, ativo),
  CONSTRAINT fk_alunos_turma
    FOREIGN KEY (turma_id)
    REFERENCES turmas(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS responsaveis (
  id INT AUTO_INCREMENT PRIMARY KEY,
  aluno_id INT NOT NULL,
  nome VARCHAR(150) NOT NULL,
  parentesco VARCHAR(50) NOT NULL DEFAULT 'Responsável',
  contato VARCHAR(30) NOT NULL,
  email VARCHAR(150) NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_responsaveis_aluno (aluno_id),
  KEY idx_responsaveis_contato (contato),
  KEY idx_responsaveis_nome (nome),
  CONSTRAINT fk_responsaveis_aluno
    FOREIGN KEY (aluno_id)
    REFERENCES alunos(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chamadas_diarias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  professor_id INT NOT NULL,
  professor_nome VARCHAR(100) NOT NULL,
  turma_id INT NULL,
  turma_nome VARCHAR(50) NOT NULL,
  materia VARCHAR(100) NOT NULL,
  data_chamada DATE NOT NULL,
  horario_chamada TIME NOT NULL DEFAULT (CURRENT_TIME),
  alunos JSON NOT NULL,
  total_presentes INT NOT NULL DEFAULT 0,
  total_ausentes INT NOT NULL DEFAULT 0,
  atraso_processado BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('pendente', 'confirmada', 'cancelada') NOT NULL DEFAULT 'pendente',
  confirmada_por_id INT NULL,
  confirmado_em DATETIME NULL,
  bloqueada_em DATETIME NULL,
  versao INT NOT NULL DEFAULT 1,
  chamada_ativa_key TINYINT
    GENERATED ALWAYS AS (
      CASE WHEN status <> 'cancelada' THEN 1 ELSE NULL END
    ) STORED,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_chamada_turma_data_ativa (turma_id, data_chamada, chamada_ativa_key),
  KEY idx_chamadas_data_materia (data_chamada, materia),
  KEY idx_chamadas_turma_data_materia (turma_id, data_chamada, materia),
  KEY idx_chamadas_professor_data (professor_id, data_chamada),
  KEY idx_chamadas_status (status),
  KEY idx_chamadas_turma_data_status (turma_id, data_chamada, status),
  CONSTRAINT fk_chamadas_professor
    FOREIGN KEY (professor_id)
    REFERENCES usuarios(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_chamadas_turma
    FOREIGN KEY (turma_id)
    REFERENCES turmas(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_chamadas_confirmada_por
    FOREIGN KEY (confirmada_por_id)
    REFERENCES usuarios(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS registros_chamadas_confirmadas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chamada_diaria_id_origem INT NULL,
  professor_id INT NOT NULL,
  professor_nome VARCHAR(100) NOT NULL,
  pedagoga_id INT NOT NULL,
  pedagoga_nome VARCHAR(100) NOT NULL,
  turma_id INT NULL,
  turma_nome VARCHAR(50) NOT NULL,
  materia VARCHAR(100) NOT NULL,
  data_chamada DATE NOT NULL,
  horario_chamada TIME NOT NULL,
  total_presentes INT NOT NULL DEFAULT 0,
  total_ausentes INT NOT NULL DEFAULT 0,
  total_justificados INT NOT NULL DEFAULT 0,
  total_atrasos INT NOT NULL DEFAULT 0,
  observacao TEXT NULL,
  confirmado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_reg_chamada_origem (chamada_diaria_id_origem),
  KEY idx_reg_chamada_data (data_chamada),
  KEY idx_reg_chamada_turma_data (turma_id, data_chamada),
  KEY idx_rcc_turma_data (turma_id, data_chamada),
  KEY idx_reg_chamada_professor_data (professor_id, data_chamada),
  KEY idx_reg_chamada_pedagoga_data (pedagoga_id, data_chamada),
  KEY idx_reg_chamada_materia (materia),
  KEY idx_reg_origem (chamada_diaria_id_origem),
  CONSTRAINT fk_reg_chamada_origem
    FOREIGN KEY (chamada_diaria_id_origem)
    REFERENCES chamadas_diarias(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_reg_chamada_professor
    FOREIGN KEY (professor_id)
    REFERENCES usuarios(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_reg_chamada_pedagoga
    FOREIGN KEY (pedagoga_id)
    REFERENCES usuarios(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_reg_chamada_turma
    FOREIGN KEY (turma_id)
    REFERENCES turmas(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS registros_frequencia_alunos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  registro_chamada_id INT NOT NULL,
  aluno_id INT NOT NULL,
  aluno_nome VARCHAR(150) NOT NULL,
  turma_id INT NULL,
  turma_nome VARCHAR(50) NOT NULL,
  materia VARCHAR(100) NOT NULL,
  data_chamada DATE NOT NULL,
  status ENUM('presente', 'ausente', 'justificado') NOT NULL,
  atrasado BOOLEAN NOT NULL DEFAULT FALSE,
  horario_registro_atraso TIME NULL,
  atraso_registrado_em DATETIME NULL,
  atraso_minutos INT NULL,
  alterado_por_id INT NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_freq_aluno_chamada (registro_chamada_id, aluno_id),
  KEY idx_freq_aluno_data (aluno_id, data_chamada),
  KEY idx_freq_turma_data (turma_id, data_chamada),
  KEY idx_freq_status (status),
  KEY idx_freq_materia (materia),
  KEY idx_freq_reg_status_atrasado (registro_chamada_id, status, atrasado),
  KEY idx_rfa_data_registro (data_chamada, registro_chamada_id),
  KEY idx_rfa_turma_data (turma_id, data_chamada),
  KEY idx_rfa_aluno_data (aluno_id, data_chamada),
  KEY idx_freq_relatorios_data_turma (data_chamada, turma_id, materia),
  KEY idx_freq_relatorios_status_atraso (status, atrasado, data_chamada),
  KEY idx_rfa_automacao_faltas_dia (data_chamada, status, aluno_id),
  CONSTRAINT fk_freq_registro_chamada
    FOREIGN KEY (registro_chamada_id)
    REFERENCES registros_chamadas_confirmadas(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_freq_aluno
    FOREIGN KEY (aluno_id)
    REFERENCES alunos(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_freq_turma
    FOREIGN KEY (turma_id)
    REFERENCES turmas(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_freq_alterado_por
    FOREIGN KEY (alterado_por_id)
    REFERENCES usuarios(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS justificativas_frequencia (
  id INT AUTO_INCREMENT PRIMARY KEY,
  frequencia_aluno_id INT NOT NULL,
  aluno_id INT NOT NULL,
  registro_chamada_id INT NOT NULL,
  motivo TEXT NOT NULL,
  anexos JSON NULL,
  registrada_por_id INT NOT NULL,
  registrada_por_nome VARCHAR(100) NOT NULL,
  registrada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_just_aluno (aluno_id),
  KEY idx_just_chamada (registro_chamada_id),
  KEY idx_jf_aluno_freq (aluno_id, frequencia_aluno_id),
  KEY idx_just_relatorios_aluno_data (aluno_id, frequencia_aluno_id),
  KEY idx_just_registrada_em (registrada_em),
  CONSTRAINT fk_just_freq
    FOREIGN KEY (frequencia_aluno_id)
    REFERENCES registros_frequencia_alunos(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_just_aluno
    FOREIGN KEY (aluno_id)
    REFERENCES alunos(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_just_chamada
    FOREIGN KEY (registro_chamada_id)
    REFERENCES registros_chamadas_confirmadas(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_just_usuario
    FOREIGN KEY (registrada_por_id)
    REFERENCES usuarios(id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chamada_auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  chamada_id INT NOT NULL,
  usuario_id INT NULL,
  usuario_perfil VARCHAR(30) NOT NULL,
  evento ENUM('CHAMADA_CRIADA', 'CHAMADA_EDITADA_PELO_PROFESSOR', 'CHAMADA_EDITADA_PELA_PEDAGOGIA', 'ALUNO_MARCADO_COMO_ATRASADO', 'JUSTIFICATIVA_ADICIONADA', 'CHAMADA_CONFIRMADA', 'EDICAO_BLOQUEADA_POR_HORARIO') NOT NULL,
  valores_anteriores JSON NULL,
  valores_novos JSON NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chamada_auditoria_chamada_data (chamada_id, criado_em),
  KEY idx_chamada_auditoria_usuario_data (usuario_id, criado_em),
  CONSTRAINT fk_chamada_auditoria_chamada FOREIGN KEY (chamada_id) REFERENCES chamadas_diarias(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_chamada_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS configuracoes_escola (
  id INT PRIMARY KEY DEFAULT 1,
  horario_limite_atraso TIME NOT NULL DEFAULT '07:45:00',
  tempo_maximo_justificativas_meses TINYINT NOT NULL DEFAULT 1,
  bloquear_edicao_chamadas_apos_horario BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_configuracoes_escola_id
    CHECK (id = 1),
  CONSTRAINT chk_tempo_justificativas_meses
    CHECK (tempo_maximo_justificativas_meses BETWEEN 1 AND 3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO configuracoes_escola (
  id,
  horario_limite_atraso,
  tempo_maximo_justificativas_meses,
  bloquear_edicao_chamadas_apos_horario
)
VALUES (1, '07:45:00', 1, TRUE)
ON DUPLICATE KEY UPDATE
  horario_limite_atraso = VALUES(horario_limite_atraso),
  tempo_maximo_justificativas_meses = VALUES(tempo_maximo_justificativas_meses),
  bloquear_edicao_chamadas_apos_horario = bloquear_edicao_chamadas_apos_horario;

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
  id, ultima_execucao_em, ultima_quantidade_removida, proxima_execucao_em
)
VALUES (1, NULL, 0, NOW())
ON DUPLICATE KEY UPDATE id = id;


CREATE TABLE IF NOT EXISTS config_mensagem_whatsapp (
  id TINYINT PRIMARY KEY DEFAULT 1,
  texto TEXT NOT NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_config_mensagem_whatsapp_id
    CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO config_mensagem_whatsapp (id, texto)
VALUES (
  1,
  'Olá, tudo bem? Identificamos uma falta registrada hoje. Poderia informar o motivo da ausência?'
)
ON DUPLICATE KEY UPDATE
  texto = texto;

CREATE TABLE IF NOT EXISTS grupos_whatsapp (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome_grupo VARCHAR(150) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_grupos_whatsapp_nome (nome_grupo),
  KEY idx_grupos_whatsapp_ativo_nome (ativo, nome_grupo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fila_automacao (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  chave_idempotencia VARCHAR(160) NOT NULL,
  usuario_solicitante_id INT NULL,
  usuario_solicitante_nome VARCHAR(100) NULL,
  maquina_destino TINYINT NOT NULL,
  tipo_automacao ENUM('faltas', 'mensagem_grupo') NOT NULL DEFAULT 'faltas',
  registro_chamada_id INT NULL,
  mensagem TEXT NULL,
  payload JSON NULL,
  versao_api SMALLINT UNSIGNED NOT NULL DEFAULT 2,
  status ENUM(
    'pendente',
    'executando',
    'concluido',
    'concluido_parcial',
    'erro',
    'falha_comunicacao',
    'expirado',
    'cancelado'
  ) NOT NULL DEFAULT 'pendente',
  lock_owner VARCHAR(100) NULL,
  lock_adquirido_em DATETIME NULL,
  data_solicitacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  iniciado_em DATETIME NULL,
  concluido_em DATETIME NULL,
  tentativas INT NOT NULL DEFAULT 0,
  total_destinatarios INT UNSIGNED NOT NULL DEFAULT 0,
  total_sucessos INT UNSIGNED NOT NULL DEFAULT 0,
  total_falhas INT UNSIGNED NOT NULL DEFAULT 0,
  identificador_externo VARCHAR(100) NULL,
  erro TEXT NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_fila_automacao_request_id (request_id),
  UNIQUE KEY uk_fila_automacao_idempotencia (chave_idempotencia),
  KEY idx_fila_maquina_fifo (maquina_destino, status, data_solicitacao, id),
  KEY idx_fila_registro_chamada (registro_chamada_id, tipo_automacao),
  KEY idx_fila_automacao_status_data (status, data_solicitacao),
  KEY idx_fila_captura_segura (status, maquina_destino, data_solicitacao),
  KEY idx_fila_tipo_status_maquina (tipo_automacao, status, maquina_destino, data_solicitacao),
  KEY idx_fila_mensagens_grupo (tipo_automacao, status, maquina_destino, data_solicitacao),
  KEY idx_fila_usuario (usuario_solicitante_id),
  KEY idx_fila_lock (lock_owner, status),
  CONSTRAINT fk_fila_usuario_solicitante
    FOREIGN KEY (usuario_solicitante_id)
    REFERENCES usuarios(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_fila_registro_chamada
    FOREIGN KEY (registro_chamada_id)
    REFERENCES registros_chamadas_confirmadas(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT chk_fila_maquina_destino
    CHECK (maquina_destino BETWEEN 1 AND 5),
  CONSTRAINT chk_fila_tentativas
    CHECK (tentativas >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automacao_entregas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  fila_automacao_id INT NOT NULL,
  chave_idempotencia VARCHAR(100) NOT NULL,
  tipo_destino ENUM('responsavel', 'grupo') NOT NULL,
  destinatario_nome VARCHAR(150) NULL,
  aluno_id INT NULL,
  aluno_nome VARCHAR(150) NULL,
  frequencia_aluno_id INT NULL,
  responsavel_id INT NULL,
  grupo_whatsapp_id INT NULL,
  grupo_nome VARCHAR(150) NULL,
  data_referencia DATE NULL,
  telefone_destino VARCHAR(20) NULL,
  telefone_mascarado VARCHAR(24) NULL,
  mensagem TEXT NULL,
  status ENUM('pendente', 'processando', 'enviado', 'erro', 'cancelado', 'ignorado')
    NOT NULL DEFAULT 'pendente',
  retentavel BOOLEAN NOT NULL DEFAULT TRUE,
  tentativas TINYINT UNSIGNED NOT NULL DEFAULT 0,
  lock_owner VARCHAR(100) NULL,
  lock_adquirido_em DATETIME NULL,
  erro_codigo VARCHAR(80) NULL,
  erro_mensagem VARCHAR(255) NULL,
  identificador_externo VARCHAR(100) NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  iniciado_em DATETIME NULL,
  concluido_em DATETIME NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_automacao_entregas_idempotencia (chave_idempotencia),
  KEY idx_automacao_entregas_fila_status (fila_automacao_id, status, tentativas, id),
  KEY idx_automacao_entregas_lock (status, lock_adquirido_em),
  KEY idx_automacao_entregas_aluno_data (aluno_id, data_referencia),
  CONSTRAINT fk_automacao_entregas_fila
    FOREIGN KEY (fila_automacao_id) REFERENCES fila_automacao(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_entregas_aluno
    FOREIGN KEY (aluno_id) REFERENCES alunos(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_entregas_frequencia
    FOREIGN KEY (frequencia_aluno_id) REFERENCES registros_frequencia_alunos(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_entregas_responsavel
    FOREIGN KEY (responsavel_id) REFERENCES responsaveis(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_entregas_grupo
    FOREIGN KEY (grupo_whatsapp_id) REFERENCES grupos_whatsapp(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_automacao_entregas_tentativas CHECK (tentativas <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automacao_maquinas (
  maquina_id TINYINT NOT NULL PRIMARY KEY,
  identidade VARCHAR(30) NOT NULL,
  nome_exibicao VARCHAR(60) NOT NULL,
  habilitada BOOLEAN NOT NULL DEFAULT TRUE,
  estado ENUM('online_available', 'online_busy', 'online_error', 'offline', 'updating', 'disabled')
    NOT NULL DEFAULT 'offline',
  ultima_comunicacao_em DATETIME NULL,
  versao_aplicativo VARCHAR(30) NULL,
  versao_minima VARCHAR(30) NOT NULL DEFAULT '2.0.0',
  tarefa_atual_id INT NULL,
  worker_id VARCHAR(80) NULL,
  ultimo_erro_codigo VARCHAR(80) NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_automacao_maquinas_identidade (identidade),
  KEY idx_automacao_maquinas_estado_heartbeat (estado, ultima_comunicacao_em),
  CONSTRAINT fk_automacao_maquinas_tarefa_atual
    FOREIGN KEY (tarefa_atual_id) REFERENCES fila_automacao(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    FOREIGN KEY (fila_automacao_id) REFERENCES fila_automacao(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_automacao_eventos_entrega
    FOREIGN KEY (automacao_entrega_id) REFERENCES automacao_entregas(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

DELETE FROM sessoes_ativas WHERE expira_em <= NOW();

UPDATE fila_automacao
   SET status = 'pendente',
       lock_owner = NULL,
       lock_adquirido_em = NULL,
       iniciado_em = NULL,
       erro = COALESCE(erro, 'Lock liberado automaticamente por inatividade superior a 30 minutos.')
 WHERE status = 'executando'
   AND lock_adquirido_em < DATE_SUB(NOW(), INTERVAL 30 MINUTE);


migration feita no dia 20/06/2026
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

-- 11. Chamadas pendentes/canceladas antigas: preserva chamadas confirmadas ja migradas para historico.
DELETE FROM chamadas_diarias
WHERE data_chamada < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
  AND status = 'cancelada';

-- 12. Fila de automacao finalizada antiga: dado operacional.
DELETE FROM fila_automacao
WHERE status IN ('concluido', 'erro', 'expirado', 'cancelado')
  AND data_solicitacao < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- 14. Libera locks travados sem apagar tarefas pendentes.
UPDATE fila_automacao
SET status = 'pendente',
    lock_owner = NULL,
    lock_adquirido_em = NULL,
    iniciado_em = NULL,
    erro = COALESCE(erro, 'Lock liberado automaticamente por inatividade superior a 30 minutos.')
WHERE status = 'executando'
  AND lock_adquirido_em < DATE_SUB(NOW(), INTERVAL 30 MINUTE);

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

EXPLAIN
SELECT
  COALESCE(SUM(CASE WHEN (COALESCE(rfa.atrasado, FALSE) = TRUE OR LOWER(COALESCE(rfa.status, '')) IN ('presente', 'atrasado')) THEN 1 ELSE 0 END), 0) AS presentes,
  COALESCE(SUM(CASE WHEN NOT (COALESCE(rfa.atrasado, FALSE) = TRUE OR LOWER(COALESCE(rfa.status, '')) IN ('presente', 'atrasado')) AND LOWER(COALESCE(rfa.status, '')) IN ('ausente', 'falta', 'faltou', 'justificado') THEN 1 ELSE 0 END), 0) AS ausentes,
  COALESCE(SUM(CASE WHEN NOT (COALESCE(rfa.atrasado, FALSE) = TRUE OR LOWER(COALESCE(rfa.status, '')) = 'atrasado') AND LOWER(COALESCE(rfa.status, '')) = 'justificado' THEN 1 ELSE 0 END), 0) AS justificados,
  COALESCE(SUM(CASE WHEN (COALESCE(rfa.atrasado, FALSE) = TRUE OR LOWER(COALESCE(rfa.status, '')) = 'atrasado') THEN 1 ELSE 0 END), 0) AS atrasos,
  COUNT(DISTINCT rfa.registro_chamada_id) AS chamadas
FROM registros_frequencia_alunos rfa
WHERE rfa.data_chamada >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)
  AND rfa.data_chamada < DATE_ADD(CURDATE(), INTERVAL 1 DAY);

Regra dos indicadores: faltas justificadas são uma subcategoria das ausências e alunos atrasados são uma subcategoria das presenças. Portanto, o total geral é `presentes + ausentes`; justificativas e atrasos não devem ser somados novamente.

EXPLAIN
SELECT id, professor_id, professor_nome, turma_id, turma_nome, materia,
       data_chamada, horario_chamada, alunos, total_presentes, total_ausentes, status
FROM chamadas_diarias
WHERE data_chamada = CURDATE()
  AND status = 'pendente'
ORDER BY horario_chamada DESC, id DESC;


USE Sistema_Chamada;

ALTER TABLE registros_chamadas_confirmadas DROP INDEX idx_rcc_data_id;
ALTER TABLE registros_frequencia_alunos DROP INDEX idx_rfa_data_status_atraso;
ALTER TABLE registros_frequencia_alunos DROP INDEX idx_rfa_data_aluno;
ALTER TABLE registros_frequencia_alunos DROP INDEX idx_rfa_data_turma;
ALTER TABLE justificativas_frequencia DROP INDEX idx_jf_freq_aluno;
ALTER TABLE chamadas_diarias DROP INDEX idx_cd_data_status_horario;
ALTER TABLE alunos DROP INDEX idx_alunos_turma_nome;
ALTER TABLE usuarios DROP INDEX idx_usuarios_tipo_ativo_nome;
