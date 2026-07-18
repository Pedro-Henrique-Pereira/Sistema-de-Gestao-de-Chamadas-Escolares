require("dotenv").config({ path: "config.env" });

const bcrypt = require("bcrypt");
const db = require("../database/connection");

async function criarUsuarioTeste() {
  try {
    const email = String(process.env.TEST_ADMIN_EMAIL || "").trim().toLowerCase();
    const senha = String(process.env.TEST_ADMIN_PASSWORD || "");

    if (!email || senha.length < 6) {
      throw new Error(
        "Defina TEST_ADMIN_EMAIL e TEST_ADMIN_PASSWORD para criar a conta temporaria."
      );
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    await db.execute(
      `
      INSERT INTO usuarios 
      (nome, email, senha_hash, tipo, ativo)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        "ADMINISTRADOR",
        email,
        senhaHash,
        "administracao",
        true,
      ]
    );

    console.log("Usuário criado com sucesso!");

    process.exit();
  } catch (error) {
    console.error(`Erro ao criar usuario de teste. code=${error.code || "TEST_USER_ERROR"}`);
    process.exit(1);
  }
}

criarUsuarioTeste();
