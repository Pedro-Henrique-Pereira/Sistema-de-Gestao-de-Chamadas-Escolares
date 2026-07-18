const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validarNomeUsuario,
  validarEmailUsuario,
  validarSenhaUsuario,
  validarCargoEquipe,
  normalizarCargoParaTipo,
  normalizarErroEmailDuplicado,
} = require("../utils/usuarioValidation");

test("normaliza nome e e-mail de contas da equipe", () => {
  assert.equal(validarNomeUsuario("  Maria   da Silva  "), "MARIA DA SILVA");
  assert.equal(validarEmailUsuario("  MARIA@ESCOLA.COM.BR "), "maria@escola.com.br");
  assert.equal(validarEmailUsuario("conta@intranet"), "conta@intranet");
});

test("rejeita nome e e-mail fora do contrato do banco", () => {
  assert.throws(
    () => validarNomeUsuario("A"),
    (error) => error.status === 400 && error.message.includes("Nome inválido")
  );
  assert.throws(
    () => validarNomeUsuario("A".repeat(101)),
    (error) => error.status === 400 && error.message.includes("Nome inválido")
  );
  assert.throws(
    () => validarEmailUsuario("usuario@"),
    (error) => error.status === 400 && error.message === "E-mail inválido."
  );
  assert.throws(
    () => validarEmailUsuario(`${"a".repeat(90)}@escola.com.br`),
    (error) => error.status === 400 && error.message === "E-mail inválido."
  );
});

test("aplica a mesma regra de senha no cadastro e na edição", () => {
  assert.equal(validarSenhaUsuario("123456", { obrigatoria: true }), "123456");
  assert.equal(validarSenhaUsuario("", { obrigatoria: false }), null);
  assert.throws(
    () => validarSenhaUsuario("12345", { obrigatoria: true }),
    (error) => error.status === 400 && error.message.includes("pelo menos 6 caracteres")
  );
  assert.throws(
    () => validarSenhaUsuario("12345"),
    (error) => error.status === 400 && error.message.includes("pelo menos 6 caracteres")
  );
  assert.throws(
    () => validarSenhaUsuario("x".repeat(129), { obrigatoria: true }),
    (error) => error.status === 400 && error.message.includes("no máximo 128 caracteres")
  );
});

test("aceita somente os cargos institucionais suportados", () => {
  assert.deepEqual(validarCargoEquipe("Administrador"), {
    cargo: "Administrador",
    tipo: "administracao",
  });
  assert.deepEqual(validarCargoEquipe("administração"), {
    cargo: "Administrador",
    tipo: "administracao",
  });
  assert.equal(normalizarCargoParaTipo("pedagoga"), "pedagoga");
  assert.equal(normalizarCargoParaTipo("Professor"), "professor");
  assert.throws(
    () => validarCargoEquipe("superadmin"),
    (error) => error.status === 400 && error.message.includes("Cargo inválido")
  );
});

test("converte duplicidade de e-mail em conflito sem expor erro do banco", () => {
  const erroBanco = Object.assign(new Error("Duplicate entry"), {
    code: "ER_DUP_ENTRY",
  });
  const erroPublico = normalizarErroEmailDuplicado(erroBanco);

  assert.equal(erroPublico.status, 409);
  assert.equal(erroPublico.message, "Este e-mail já pertence a outro usuário.");

  const erroOriginal = new Error("Falha diferente");
  assert.equal(normalizarErroEmailDuplicado(erroOriginal), erroOriginal);
});
