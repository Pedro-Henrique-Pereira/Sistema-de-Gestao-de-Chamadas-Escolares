import test from "node:test";
import assert from "node:assert/strict";
import { resolverAcessoProtegido, rotaInicialPorPerfil } from "../utils/authRouting.js";
import {
  criarControleValidacao,
  iniciarValidacao,
  invalidarValidacoes,
  validacaoContinuaAtual,
} from "../utils/authValidation.js";

const professor = { id: 4, tipo: "professor" };
const pedagoga = { id: 2, tipo: "pedagoga" };
const administracao = { id: 1, tipo: "administracao" };

test("direciona cada perfil autenticado para sua área", () => {
  assert.equal(rotaInicialPorPerfil("professor"), "/professor");
  assert.equal(rotaInicialPorPerfil("pedagoga"), "/pedagoga");
  assert.equal(rotaInicialPorPerfil("administracao"), "/admin");
});

test("aguarda a validação da sessão no carregamento e no F5", () => {
  assert.deepEqual(
    resolverAcessoProtegido({ carregando: true, usuario: null, cargosPermitidos: ["professor"] }),
    { estado: "carregando" },
  );
});

test("permite acesso direto do professor à rota correta", () => {
  assert.equal(
    resolverAcessoProtegido({ carregando: false, usuario: professor, cargosPermitidos: ["professor"] }).estado,
    "permitido",
  );
});

test("permite pedagoga apenas nas áreas declaradas", () => {
  assert.equal(
    resolverAcessoProtegido({ carregando: false, usuario: pedagoga, cargosPermitidos: ["pedagoga", "administracao"] }).estado,
    "permitido",
  );
});

test("permite administrador nas áreas declaradas", () => {
  assert.equal(
    resolverAcessoProtegido({ carregando: false, usuario: administracao, cargosPermitidos: ["administracao"] }).estado,
    "permitido",
  );
});

test("envia usuário não autenticado ao login", () => {
  assert.deepEqual(
    resolverAcessoProtegido({ carregando: false, usuario: null, cargosPermitidos: ["professor"] }),
    { estado: "login", destino: "/login" },
  );
});

test("nega perfil sem permissão sem apagar a sessão nem enviar ao login", () => {
  assert.deepEqual(
    resolverAcessoProtegido({ carregando: false, usuario: professor, cargosPermitidos: ["administracao"] }),
    { estado: "sem_permissao", destino: "/professor" },
  );
});

test("um 401 representado por ausência de usuário termina no login", () => {
  const acesso = resolverAcessoProtegido({ carregando: false, erro: null, usuario: null, cargosPermitidos: ["professor"] });
  assert.equal(acesso.destino, "/login");
});

test("um 403 não autenticador conserva o perfil e volta à área autorizada", () => {
  const acesso = resolverAcessoProtegido({ carregando: false, erro: null, usuario: professor, cargosPermitidos: ["pedagoga"] });
  assert.equal(acesso.estado, "sem_permissao");
  assert.equal(acesso.destino, "/professor");
});

test("falha de rede ou servidor ao validar a sessão mostra opção de nova tentativa", () => {
  assert.deepEqual(
    resolverAcessoProtegido({ carregando: false, erro: new Error("offline"), usuario: null, cargosPermitidos: ["professor"] }),
    { estado: "erro" },
  );
});

test("resposta 401 antiga não sobrescreve um login concluído", () => {
  const controle = criarControleValidacao();
  const validacaoPendente = iniciarValidacao(controle);

  invalidarValidacoes(controle);

  assert.equal(validacaoContinuaAtual(controle, validacaoPendente), false);
});
