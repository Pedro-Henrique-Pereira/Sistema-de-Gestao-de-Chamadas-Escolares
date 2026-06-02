require("dotenv").config({ path: "config.env" });

const bcrypt = require("bcrypt");
const db = require("../database/connection");

async function criarUsuarioTeste() {
  try {
    const senhaHash = await bcrypt.hash("123456", 10);

    await db.execute(
      `
      INSERT INTO usuarios 
      (nome, email, senha_hash, tipo, ativo)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        "ADMINISTRADOR",
        "administrador@gmail.com",
        senhaHash,
        "administracao",
        true,
      ]
    );

    console.log("Usuário criado com sucesso!");
    console.log("Email: administrador@gmail.com");
    console.log("Senha: 123456");

    process.exit();
  } catch (error) {
    console.error("Erro ao criar usuário:", error);
    process.exit(1);
  }
}

criarUsuarioTeste();