const bcrypt = require("bcrypt");
const db = require("../database/db");
const {
  validarNomeUsuario,
  validarEmailUsuario,
  validarSenhaUsuario,
  normalizarErroEmailDuplicado,
} = require("../utils/usuarioValidation");
const { serializarUsuarioPublico } = require("../utils/publicDtos");
const { limparCookiesAutenticacao } = require("../utils/authCookies");

async function configurar(req, res, next) {
  try {
    const usuarioId = Number(req.usuario.id);
    const nome = validarNomeUsuario(req.body.nome);
    const email = validarEmailUsuario(req.body.email);
    const senha = validarSenhaUsuario(req.body.senha);

    const [emailExistente] = await db.execute(
      "SELECT id FROM usuarios WHERE email = ? AND id <> ? LIMIT 1",
      [email, usuarioId]
    );

    if (emailExistente[0]) {
      return res.status(409).json({ erro: "Este e-mail já pertence a outro usuário." });
    }

    if (senha) {
      const senhaHash = await bcrypt.hash(senha, 10);
      const connection = await db.getConnection();

      try {
        await connection.beginTransaction();
        await connection.execute(
          "UPDATE usuarios SET nome = ?, email = ?, senha_hash = ? WHERE id = ?",
          [nome, email, senhaHash, usuarioId]
        );
        await connection.execute("DELETE FROM sessoes_ativas WHERE usuario_id = ?", [usuarioId]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } else {
      await db.execute(
        "UPDATE usuarios SET nome = ?, email = ? WHERE id = ?",
        [nome, email, usuarioId]
      );
    }

    const [rows] = await db.execute(
      "SELECT id, nome, email, tipo, ativo, criado_em FROM usuarios WHERE id = ? LIMIT 1",
      [usuarioId]
    );

    if (senha) {
      limparCookiesAutenticacao(res);
    }

    return res.json({
      mensagem: "Configurações atualizadas com sucesso.",
      usuario: serializarUsuarioPublico(rows[0]),
      sessaoEncerrada: Boolean(senha),
    });
  } catch (error) {
    return next(normalizarErroEmailDuplicado(error));
  }
}

module.exports = { configurar };
