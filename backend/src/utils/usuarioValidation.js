const { formatarEmail, formatarNome } = require("./formatadores");

const CARGOS_EQUIPE = new Map([
  ["administrador", { cargo: "Administrador", tipo: "administracao" }],
  ["administracao", { cargo: "Administrador", tipo: "administracao" }],
  ["pedagoga", { cargo: "Pedagoga", tipo: "pedagoga" }],
  ["professor", { cargo: "Professor", tipo: "professor" }],
]);

function criarErroValidacao(mensagem) {
  const erro = new Error(mensagem);
  erro.status = 400;
  return erro;
}

function normalizarTexto(valor) {
  return String(valor ?? "").trim();
}

function normalizarChave(valor) {
  return normalizarTexto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function validarNomeUsuario(valor) {
  const nome = formatarNome(valor);

  if (nome.length < 2 || nome.length > 100) {
    throw criarErroValidacao("Nome inválido. Informe entre 2 e 100 caracteres.");
  }

  return nome;
}

function validarEmailUsuario(valor) {
  const email = formatarEmail(valor);
  const formatoValido = /^[^\s@]+@[^\s@]+$/.test(email);

  if (!formatoValido || email.length > 100) {
    throw criarErroValidacao("E-mail inválido.");
  }

  return email;
}

function validarSenhaUsuario(valor, { obrigatoria = false } = {}) {
  const senha = normalizarTexto(valor);

  if (!senha && !obrigatoria) {
    return null;
  }

  if (senha.length < 6) {
    throw criarErroValidacao("A senha deve ter pelo menos 6 caracteres.");
  }

  if (senha.length > 128) {
    throw criarErroValidacao("A senha deve ter no máximo 128 caracteres.");
  }

  return senha;
}

function validarCargoEquipe(valor) {
  const cargo = CARGOS_EQUIPE.get(normalizarChave(valor));

  if (!cargo) {
    throw criarErroValidacao(
      "Cargo inválido. Selecione Administrador, Pedagoga ou Professor."
    );
  }

  return { ...cargo };
}

function normalizarCargoParaTipo(valor) {
  return validarCargoEquipe(valor).tipo;
}

function normalizarErroEmailDuplicado(error) {
  if (error?.code !== "ER_DUP_ENTRY") {
    return error;
  }

  const erro = new Error("Este e-mail já pertence a outro usuário.");
  erro.status = 409;
  return erro;
}

module.exports = {
  validarNomeUsuario,
  validarEmailUsuario,
  validarSenhaUsuario,
  validarCargoEquipe,
  normalizarCargoParaTipo,
  normalizarErroEmailDuplicado,
};
