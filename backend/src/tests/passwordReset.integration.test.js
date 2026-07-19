const net = require("net");
const path = require("path");
const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");

require("dotenv").config({
  path: path.resolve(__dirname, "../../config.env"),
  quiet: true,
});

const db = require("../database/db");
const authController = require("../controllers/authController");
const { criarPasswordResetService } = require("../services/passwordResetService");

function iniciarSmtpCaptura() {
  let resolverMensagem;
  let rejeitarMensagem;
  const mensagemRecebida = new Promise((resolve, reject) => {
    resolverMensagem = resolve;
    rejeitarMensagem = reject;
  });

  const server = net.createServer((socket) => {
    let buffer = "";
    let recebendoDados = false;

    socket.setEncoding("utf8");
    socket.write("220 localhost ESMTP teste\r\n");

    socket.on("data", (chunk) => {
      buffer += chunk;

      if (recebendoDados) {
        const fim = buffer.indexOf("\r\n.\r\n");
        if (fim === -1) return;

        resolverMensagem(buffer.slice(0, fim));
        buffer = buffer.slice(fim + 5);
        recebendoDados = false;
        socket.write("250 2.0.0 mensagem aceita\r\n");
      }

      while (!recebendoDados) {
        const fimLinha = buffer.indexOf("\r\n");
        if (fimLinha === -1) break;

        const linha = buffer.slice(0, fimLinha);
        buffer = buffer.slice(fimLinha + 2);
        const comando = linha.toUpperCase();

        if (comando.startsWith("EHLO") || comando.startsWith("HELO")) {
          socket.write("250-localhost\r\n250 SIZE 10485760\r\n");
        } else if (comando.startsWith("MAIL FROM") || comando.startsWith("RCPT TO")) {
          socket.write("250 2.1.0 ok\r\n");
        } else if (comando === "DATA") {
          recebendoDados = true;
          socket.write("354 termine com ponto\r\n");
        } else if (comando === "QUIT") {
          socket.write("221 2.0.0 encerrando\r\n");
          socket.end();
        } else if (linha) {
          socket.write("250 2.0.0 ok\r\n");
        }
      }
    });

    socket.on("error", rejeitarMensagem);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
        mensagemRecebida,
      });
    });
  });
}

function executarLogin(email, senha) {
  return new Promise((resolve, reject) => {
    const resposta = {
      statusCode: 200,
      cookies: [],
      cookie(nome, valor, options) {
        this.cookies.push({ nome, valor, options });
        return this;
      },
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({
          status: this.statusCode,
          body,
          cookies: this.cookies,
        });
        return this;
      },
    };

    authController.login(
      {
        body: { email, senha },
        get(nome) {
          return nome === "user-agent" ? "password-reset-integration-test" : "";
        },
      },
      resposta,
      reject
    );
  });
}

function executarLogout(usuarioId) {
  return new Promise((resolve, reject) => {
    const resposta = {
      statusCode: 200,
      cookiesLimpos: [],
      clearCookie(nome) {
        this.cookiesLimpos.push(nome);
        return this;
      },
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({
          status: this.statusCode,
          body,
          cookiesLimpos: this.cookiesLimpos,
        });
        return this;
      },
    };

    authController.logout(
      { usuario: { id: usuarioId } },
      resposta,
      reject
    );
  });
}

test("fluxo real usa MySQL, SMTP, troca de senha e revogação de sessão", async () => {
  const smtp = await iniciarSmtpCaptura();
  const email = `qa-reset-${Date.now()}@example.test`;
  const senhaAntiga = `Antiga-${crypto.randomBytes(6).toString("hex")}`;
  const senhaNova = `Nova-${crypto.randomBytes(8).toString("hex")}`;
  let usuarioId;
  const usuariosCriados = [];

  const envAnterior = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_REQUIRE_TLS: process.env.SMTP_REQUIRE_TLS,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
    SMTP_FROM_NAME: process.env.SMTP_FROM_NAME,
    PUBLIC_FRONTEND_URL: process.env.PUBLIC_FRONTEND_URL,
  };

  Object.assign(process.env, {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtp.port),
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "false",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM_EMAIL: "nao-responda@example.test",
    SMTP_FROM_NAME: "Sistema Escolar QA",
    PUBLIC_FRONTEND_URL: "https://sistema.example.test",
  });

  try {
    const senhaHashAntiga = await bcrypt.hash(senhaAntiga, 10);
    const [insercao] = await db.execute(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo, ativo)
       VALUES (?, ?, ?, 'professor', TRUE)`,
      ["USUARIO QA RECUPERACAO", email, senhaHashAntiga]
    );
    usuarioId = insercao.insertId;
    usuariosCriados.push(usuarioId);

    await db.execute(
      `INSERT INTO sessoes_ativas
       (id, usuario_id, token_id, dispositivo_info, criado_em, expira_em)
       VALUES (?, ?, ?, 'teste', NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY))`,
      [crypto.randomUUID(), usuarioId, crypto.randomUUID()]
    );

    const service = criarPasswordResetService({ minimumResponseMs: 0 });
    const solicitacao = await service.solicitarRecuperacao(email);
    const mensagemSmtp = await Promise.race([
      smtp.mensagemRecebida,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("E-mail SMTP não foi recebido a tempo.")),
        5000
      )),
    ]);
    const mimeSemQuebrasQuotedPrintable = mensagemSmtp.replace(/=\r\n/g, "");
    const tokensNoEmail = [
      ...mimeSemQuebrasQuotedPrintable.matchAll(/token(?:=3D|=)([A-Za-z0-9_-]{43})/g),
    ].map((match) => match[1]);

    assert.match(solicitacao.mensagem, /Se existir uma conta/);
    assert.ok(tokensNoEmail.length > 0);

    const [tokens] = await db.execute(
      `SELECT token_hash, utilizado_em, invalidado_em
       FROM recuperacoes_senha
       WHERE usuario_id = ?`,
      [usuarioId]
    );
    assert.equal(tokens.length, 1);
    const token = tokensNoEmail.find(
      (candidato) => crypto.createHash("sha256").update(candidato).digest("hex")
        === tokens[0].token_hash
    );
    assert.ok(token);
    assert.equal(tokens[0].token_hash.includes(token), false);

    assert.equal(await service.validarToken(token), true);
    await service.redefinirSenha({
      token,
      senha: senhaNova,
      confirmacaoSenha: senhaNova,
    });
    assert.equal(await service.validarToken(token), false);

    const [[usuarioAtualizado]] = await db.execute(
      "SELECT senha_hash FROM usuarios WHERE id = ?",
      [usuarioId]
    );
    assert.equal(await bcrypt.compare(senhaAntiga, usuarioAtualizado.senha_hash), false);
    assert.equal(await bcrypt.compare(senhaNova, usuarioAtualizado.senha_hash), true);

    const [[sessoes]] = await db.execute(
      "SELECT COUNT(*) AS total FROM sessoes_ativas WHERE usuario_id = ?",
      [usuarioId]
    );
    assert.equal(Number(sessoes.total), 0);

    await assert.rejects(
      service.redefinirSenha({
        token,
        senha: "OutraSenha",
        confirmacaoSenha: "OutraSenha",
      }),
      /inválido ou expirou/
    );

    const loginAntigo = await executarLogin(email, senhaAntiga);
    assert.equal(loginAntigo.status, 401);

    const loginNovo = await executarLogin(email, senhaNova);
    assert.equal(loginNovo.status, 200);
    assert.equal(loginNovo.body.usuario.email, email);
    assert.ok(loginNovo.cookies.some((cookie) => cookie.nome === "token"));

    for (const tipo of ["administracao", "pedagoga"]) {
      const emailRegressao = `qa-auth-${tipo}-${Date.now()}@example.test`;
      const senhaRegressao = `Regressao-${tipo}-123`;
      const hashRegressao = await bcrypt.hash(senhaRegressao, 10);
      const [usuarioRegressao] = await db.execute(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo, ativo)
         VALUES (?, ?, ?, ?, TRUE)`,
        [`QA AUTH ${tipo.toUpperCase()}`, emailRegressao, hashRegressao, tipo]
      );
      usuariosCriados.push(usuarioRegressao.insertId);

      const loginRegressao = await executarLogin(emailRegressao, senhaRegressao);
      assert.equal(loginRegressao.status, 200);
      assert.equal(loginRegressao.body.usuario.tipo, tipo);
      assert.ok(loginRegressao.cookies.some((cookie) => cookie.nome === "token"));

      const logoutRegressao = await executarLogout(usuarioRegressao.insertId);
      assert.equal(logoutRegressao.status, 200);
      assert.deepEqual(
        logoutRegressao.cookiesLimpos.sort(),
        ["csrfToken", "token"]
      );

      const [[sessaoAposLogout]] = await db.execute(
        "SELECT COUNT(*) AS total FROM sessoes_ativas WHERE usuario_id = ?",
        [usuarioRegressao.insertId]
      );
      assert.equal(Number(sessaoAposLogout.total), 0);
    }
  } finally {
    for (const id of usuariosCriados) {
      await db.execute("DELETE FROM usuarios WHERE id = ?", [id]);
    }

    for (const [nome, valor] of Object.entries(envAnterior)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }

    await new Promise((resolve) => smtp.server.close(resolve));
    await db.end();
  }
});
