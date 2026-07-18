export function criarControleValidacao() {
  return { id: 0 };
}

export function iniciarValidacao(controle) {
  controle.id += 1;
  return controle.id;
}

export function invalidarValidacoes(controle) {
  controle.id += 1;
}

export function validacaoContinuaAtual(controle, validacaoId) {
  return controle.id === validacaoId;
}
