const bcrypt = require("bcrypt");
const db = require("../database/db");
const { formatarEmail, formatarNome } = require("../utils/formatadores");

async function configurar(req, res, next) {
  try {
    const usuarioId = Number(req.usuario.id);
    const nome = formatarNome(req.body.nome || "");
    const email = formatarEmail(req.body.email || "");
    const senha = String(req.body.senha || "").trim();

    if (!nome || nome.length < 2) {
      return res.status(400).json({ erro: "Nome inválido." });
    }

    if (!email || !email.includes("@")) {
      return res.status(400).json({ erro: "E-mail inválido." });
    }

    const [emailExistente] = await db.execute(
      "SELECT id FROM usuarios WHERE email = ? AND id <> ? LIMIT 1",
      [email, usuarioId]
    );

    if (emailExistente[0]) {
      return res.status(409).json({ erro: "Este e-mail já pertence a outro usuário." });
    }

    if (senha) {
      if (senha.length < 6) {
        return res.status(400).json({ erro: "A senha deve ter pelo menos 6 caracteres." });
      }

      const senhaHash = await bcrypt.hash(senha, 10);
      await db.execute(
        "UPDATE usuarios SET nome = ?, email = ?, senha_hash = ? WHERE id = ?",
        [nome, email, senhaHash, usuarioId]
      );
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

    return res.json({ mensagem: "Configurações atualizadas com sucesso.", usuario: rows[0] });
  } catch (error) {
    return next(error);
  }
}

module.exports = { configurar };
