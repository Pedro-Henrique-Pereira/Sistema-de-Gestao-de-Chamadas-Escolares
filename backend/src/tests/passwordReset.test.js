const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const {
  criarPasswordResetService,
  hashToken,
  MENSAGEM_SOLICITACAO,
  MENSAGEM_TOKEN_INVALIDO,
} = require("../services/passwordResetService");
const {
  criarMensagemRedefinicao,
} = require("../services/emailService");
const authRouter = require("../routes/auth.routes");
const { errorMiddleware } = require("../utils/errorHandler");

function criarAmbiente({ usuarioExiste = true } = {}) {
  const usuario = usuarioExiste
    ? {
        id: 7,
        email: "usuario@escola.test",
        ativo: true,
        senhaHash: "hash:senha-antiga",
      }
    : null;
  const tokens = new Map();
  const envios = [];
  const tarefas = [];
  let sessoesAtivas = 2;

  const usuarioRepository = {
    async buscarPorEmail() {
      return usuario;
    },
  };

  const resetRepository = {
    async limparTokensAntigos() {
      return 0;
    },
    async criarToken({ usuarioId, tokenHash, expiraEm }) {
      for (const registro of tokens.values()) {
        if (registro.usuarioId === usuarioId && !registro.utilizadoEm) {
          registro.invalidadoEm = new Date();
        }
      }

      tokens.set(tokenHash, {
        usuarioId,
        tokenHash,
        expiraEm,
        utilizadoEm: null,
        invalidadoEm: null,
      });
    },
    async buscarTokenValido(tokenHash) {
      const registro = tokens.get(tokenHash);
      if (
        !registro
        || registro.utilizadoEm
        || registro.invalidadoEm
        || registro.expiraEm <= new Date()
      ) {
        return null;
      }
      return registro;
    },
    async redefinirSenha({ tokenHash, senhaHash }) {
      const registro = await this.buscarTokenValido(tokenHash);
      if (!registro) return false;
      registro.utilizadoEm = new Date();
      registro.invalidadoEm = new Date();
      usuario.senhaHash = senhaHash;
      sessoesAtivas = 0;
      return true;
    },
    async invalidarPorHash(tokenHash) {
      const registro = tokens.get(tokenHash);
      if (registro) registro.invalidadoEm = new Date();
    },
  };

  const mailer = {
    async enviarRedefinicaoSenha(mensagem) {
      envios.push(mensagem);
    },
  };

  const service = criarPasswordResetService({
    usuarioRepository,
    resetRepository,
    mailer,
    bcryptLib: {
      async hash(senha) {
        return `hash:${senha}`;
      },
    },
    scheduler(callback) {
      tarefas.push(callback);
    },
    minimumResponseMs: 0,
  });

  async function executarTarefas() {
    while (tarefas.length) {
      tarefas.shift()();
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return {
    service,
    tokens,
    envios,
    usuario,
    executarTarefas,
    get sessoesAtivas() {
      return sessoesAtivas;
    },
  };
}

test("solicitação gera token opaco e persiste somente o hash", async () => {
  const ambiente = criarAmbiente();

  const resposta = await ambiente.service.solicitarRecuperacao(
    "  USUARIO@ESCOLA.TEST "
  );
  await ambiente.executarTarefas();

  assert.equal(resposta.mensagem, MENSAGEM_SOLICITACAO);
  assert.equal(ambiente.envios.length, 1);

  const token = ambiente.envios[0].token;
  const hashesArmazenados = [...ambiente.tokens.keys()];

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(hashesArmazenados, [hashToken(token)]);
  assert.equal(hashesArmazenados.includes(token), false);
});

test("e-mail inexistente recebe a mesma resposta e não dispara mensagem", async () => {
  const ambiente = criarAmbiente({ usuarioExiste: false });
  const resposta = await ambiente.service.solicitarRecuperacao(
    "ausente@escola.test"
  );
  await ambiente.executarTarefas();

  assert.equal(resposta.mensagem, MENSAGEM_SOLICITACAO);
  assert.equal(ambiente.envios.length, 0);
  assert.equal(ambiente.tokens.size, 0);
});

test("nova solicitação invalida o token anterior", async () => {
  const ambiente = criarAmbiente();

  await ambiente.service.solicitarRecuperacao("usuario@escola.test");
  await ambiente.executarTarefas();
  const tokenAnterior = ambiente.envios[0].token;

  await ambiente.service.solicitarRecuperacao("usuario@escola.test");
  await ambiente.executarTarefas();
  const tokenAtual = ambiente.envios[1].token;

  assert.equal(await ambiente.service.validarToken(tokenAnterior), false);
  assert.equal(await ambiente.service.validarToken(tokenAtual), true);
});

test("token inválido ou expirado não altera a senha", async () => {
  const ambiente = criarAmbiente();
  const senhaAnterior = ambiente.usuario.senhaHash;

  await assert.rejects(
    ambiente.service.redefinirSenha({
      token: "token-invalido",
      senha: "nova123",
      confirmacaoSenha: "nova123",
    }),
    (error) => error.status === 400 && error.message === MENSAGEM_TOKEN_INVALIDO
  );

  assert.equal(ambiente.usuario.senhaHash, senhaAnterior);

  await ambiente.service.solicitarRecuperacao("usuario@escola.test");
  await ambiente.executarTarefas();
  const tokenExpirado = ambiente.envios[0].token;
  ambiente.tokens.get(hashToken(tokenExpirado)).expiraEm = new Date(Date.now() - 1);

  await assert.rejects(
    ambiente.service.redefinirSenha({
      token: tokenExpirado,
      senha: "nova123",
      confirmacaoSenha: "nova123",
    }),
    (error) => error.message === MENSAGEM_TOKEN_INVALIDO
  );
  assert.equal(ambiente.usuario.senhaHash, senhaAnterior);
});

test("redefinição troca a senha, encerra sessões e impede reutilização", async () => {
  const ambiente = criarAmbiente();

  await ambiente.service.solicitarRecuperacao("usuario@escola.test");
  await ambiente.executarTarefas();
  const token = ambiente.envios[0].token;

  const resposta = await ambiente.service.redefinirSenha({
    token,
    senha: "senha-nova",
    confirmacaoSenha: "senha-nova",
  });

  assert.match(resposta.mensagem, /Senha alterada com sucesso/);
  assert.equal(ambiente.usuario.senhaHash, "hash:senha-nova");
  assert.equal(ambiente.sessoesAtivas, 0);

  await assert.rejects(
    ambiente.service.redefinirSenha({
      token,
      senha: "outra-senha",
      confirmacaoSenha: "outra-senha",
    }),
    (error) => error.message === MENSAGEM_TOKEN_INVALIDO
  );
});

test("backend rejeita confirmação diferente e senha fora do contrato atual", async () => {
  const ambiente = criarAmbiente();

  await assert.rejects(
    ambiente.service.redefinirSenha({
      token: "x".repeat(43),
      senha: "123456",
      confirmacaoSenha: "654321",
    }),
    (error) => error.status === 400 && error.message.includes("não coincidem")
  );

  await assert.rejects(
    ambiente.service.redefinirSenha({
      token: "x".repeat(43),
      senha: "12345",
      confirmacaoSenha: "12345",
    }),
    (error) => error.status === 400 && error.message.includes("pelo menos 6")
  );
});

test("e-mail contém link temporário em texto e HTML sem senha", () => {
  const token = "A".repeat(43);
  const mensagem = criarMensagemRedefinicao({
    destinatario: "usuario@escola.test",
    token,
    expiraMinutos: 20,
    config: {
      frontendUrl: "https://sistema.escola.test",
      fromEmail: "nao-responda@escola.test",
      fromName: "Sistema Escolar",
    },
  });

  assert.match(mensagem.text, new RegExp(token));
  assert.match(mensagem.html, new RegExp(token));
  assert.match(mensagem.text, /20 minutos/);
  assert.equal(/senha-nova|senha-antiga/.test(mensagem.text), false);
  assert.equal(mensagem.to, "usuario@escola.test");
});

test("rate limit por e-mail bloqueia excesso sem consultar conta", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use(errorMiddleware);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const { port } = server.address();
    const respostas = [];

    for (let tentativa = 0; tentativa < 6; tentativa += 1) {
      respostas.push(await fetch(`http://127.0.0.1:${port}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "formato-invalido" }),
      }));
    }

    assert.deepEqual(respostas.slice(0, 5).map((resposta) => resposta.status), [
      400, 400, 400, 400, 400,
    ]);
    assert.equal(respostas[5].status, 429);

    const corpo = await respostas[5].json();
    assert.equal(Object.keys(corpo).includes("usuario"), false);
    assert.equal(Object.keys(corpo).includes("email"), false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
