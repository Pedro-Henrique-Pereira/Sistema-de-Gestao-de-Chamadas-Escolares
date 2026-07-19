const bcrypt = require("bcrypt");
const crypto = require("crypto");
const Usuario = require("../models/usuarioModel");
const passwordResetModel = require("../models/passwordResetModel");
const emailService = require("./emailService");
const { formatarEmail } = require("../utils/formatadores");
const { validarSenhaUsuario } = require("../utils/usuarioValidation");
const { safeLogError } = require("../utils/errorHandler");

const MENSAGEM_SOLICITACAO =
  "Se existir uma conta cadastrada com esse e-mail, enviaremos as instruções para recuperação da senha. Verifique sua caixa de entrada e também a pasta de spam ou lixo eletrônico.";
const MENSAGEM_TOKEN_INVALIDO = "O link é inválido ou expirou.";

function criarErroPublico(mensagem, status = 400) {
  const error = new Error(mensagem);
  error.status = status;
  return error;
}

function limitarNumero(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.min(Math.max(Math.trunc(numero), minimo), maximo);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function tokenTemFormatoValido(token) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(token || ""));
}

function criarPasswordResetService({
  usuarioRepository = Usuario,
  resetRepository = passwordResetModel,
  mailer = emailService,
  bcryptLib = bcrypt,
  scheduler = setImmediate,
  minimumResponseMs,
} = {}) {
  const expiraMinutos = limitarNumero(
    process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
    20,
    15,
    30
  );
  const respostaMinimaMs = minimumResponseMs ?? limitarNumero(
    process.env.PASSWORD_RESET_MIN_RESPONSE_MS,
    400,
    200,
    2000
  );

  async function aguardarRespostaMinima(inicio) {
    const restante = respostaMinimaMs - (Date.now() - inicio);
    if (restante > 0) {
      await new Promise((resolve) => setTimeout(resolve, restante));
    }
  }

  function agendarEnvio({ destinatario, token, tokenHash }) {
    scheduler(() => {
      Promise.resolve(
        mailer.enviarRedefinicaoSenha({
          destinatario,
          token,
          expiraMinutos,
        })
      ).catch(async (error) => {
        try {
          await resetRepository.invalidarPorHash(tokenHash);
        } catch (invalidationError) {
          safeLogError(
            "passwordResetService.Falha ao invalidar token sem entrega",
            invalidationError
          );
        }

        safeLogError("passwordResetService.Falha no envio SMTP", error);
      });
    });
  }

  async function solicitarRecuperacao(emailInformado) {
    const inicio = Date.now();
    const email = formatarEmail(emailInformado);

    await resetRepository.limparTokensAntigos();
    const usuario = await usuarioRepository.buscarPorEmail(email);

    if (usuario?.ativo) {
      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = hashToken(token);
      const expiraEm = new Date(Date.now() + expiraMinutos * 60 * 1000);

      await resetRepository.criarToken({
        usuarioId: usuario.id,
        tokenHash,
        expiraEm,
      });

      agendarEnvio({
        destinatario: email,
        token,
        tokenHash,
      });
    } else {
      crypto.createHash("sha256").update(`${email}:conta-ausente`).digest();
    }

    await aguardarRespostaMinima(inicio);
    return { mensagem: MENSAGEM_SOLICITACAO };
  }

  async function validarToken(token) {
    if (!tokenTemFormatoValido(token)) return false;

    const tokenHash = hashToken(token);
    const registro = await resetRepository.buscarTokenValido(tokenHash);
    return Boolean(registro);
  }

  async function redefinirSenha({ token, senha, confirmacaoSenha }) {
    if (senha !== confirmacaoSenha) {
      throw criarErroPublico("As senhas informadas não coincidem.");
    }

    const senhaValidada = validarSenhaUsuario(senha, { obrigatoria: true });

    if (!(await validarToken(token))) {
      throw criarErroPublico(MENSAGEM_TOKEN_INVALIDO);
    }

    const senhaHash = await bcryptLib.hash(senhaValidada, 10);
    const redefinida = await resetRepository.redefinirSenha({
      tokenHash: hashToken(token),
      senhaHash,
    });

    if (!redefinida) {
      throw criarErroPublico(MENSAGEM_TOKEN_INVALIDO);
    }

    return {
      mensagem: "Senha alterada com sucesso. Faça login novamente.",
    };
  }

  return {
    solicitarRecuperacao,
    validarToken,
    redefinirSenha,
  };
}

const passwordResetService = criarPasswordResetService();

module.exports = {
  ...passwordResetService,
  criarPasswordResetService,
  hashToken,
  tokenTemFormatoValido,
  MENSAGEM_SOLICITACAO,
  MENSAGEM_TOKEN_INVALIDO,
};
