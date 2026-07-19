const passwordResetService = require("../services/passwordResetService");
const { validarEmailUsuario } = require("../utils/usuarioValidation");

async function solicitar(req, res, next) {
  try {
    const email = validarEmailUsuario(req.body?.email);
    const resultado = await passwordResetService.solicitarRecuperacao(email);
    return res.status(202).json(resultado);
  } catch (error) {
    return next(error);
  }
}

async function validar(req, res, next) {
  try {
    const valido = await passwordResetService.validarToken(req.body?.token);

    if (!valido) {
      return res.status(400).json({
        erro: passwordResetService.MENSAGEM_TOKEN_INVALIDO,
      });
    }

    return res.status(200).json({ valido: true });
  } catch (error) {
    return next(error);
  }
}

async function redefinir(req, res, next) {
  try {
    const resultado = await passwordResetService.redefinirSenha({
      token: req.body?.token,
      senha: req.body?.senha,
      confirmacaoSenha: req.body?.confirmacaoSenha,
    });

    return res.status(200).json(resultado);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  solicitar,
  validar,
  redefinir,
};
