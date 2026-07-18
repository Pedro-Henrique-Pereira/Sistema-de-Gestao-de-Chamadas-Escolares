const axios = require("axios");

const API_URL = "http://localhost:3000/api";

const CONFIG = {
  totalRequests: 3000,
  concurrentUsers: 100,
  delayBetweenBatchesMs: 50
};

function carregarUsuarioAmbiente(tipo, prefixo) {
  const email = String(process.env[`STRESS_${prefixo}_EMAIL`] || "").trim();
  const senha = String(process.env[`STRESS_${prefixo}_PASSWORD`] || "");

  if (!email || !senha) {
    throw new Error(`Credenciais de stress ausentes para o perfil ${tipo}.`);
  }

  return { tipo, email, senha };
}

function carregarUsuariosStress() {
  return [
    carregarUsuarioAmbiente("administrador", "ADMIN"),
    carregarUsuarioAmbiente("pedagoga", "PEDAGOGA"),
    carregarUsuarioAmbiente("professor", "PROFESSOR"),
  ];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function diffMs(start) {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function calcularMetricas(tempos) {
  tempos.sort((a, b) => a - b);

  const total = tempos.length;
  const media = tempos.reduce((acc, t) => acc + t, 0) / total;

  return {
    min: tempos[0] || 0,
    media: media || 0,
    p90: tempos[Math.floor(total * 0.9)] || 0,
    p95: tempos[Math.floor(total * 0.95)] || 0,
    p99: tempos[Math.floor(total * 0.99)] || 0,
    max: tempos[total - 1] || 0
  };
}

async function login(usuario) {
  const client = axios.create({
    baseURL: API_URL,
    timeout: 15000,
    validateStatus: () => true
  });

  const start = process.hrtime.bigint();

  const res = await client.post("/auth/login", {
    email: usuario.email,
    senha: usuario.senha
  });

  const tempo = diffMs(start);

  if (res.status >= 400) {
    throw new Error(`Falha no login de ${usuario.tipo}: status ${res.status}`);
  }

  const cookies = res.headers["set-cookie"];

  if (!cookies || cookies.length === 0) {
    throw new Error(`Login de ${usuario.tipo} não retornou cookie`);
  }

  return {
    tipo: usuario.tipo,
    tempoLoginMs: tempo,
    cookieHeader: cookies.map((c) => c.split(";")[0]).join("; ")
  };
}

function escolherSessao(sessoes, numero) {
  return sessoes[numero % sessoes.length];
}

async function main() {
  console.log("===== TESTE DE STRESS MULTI-LOGIN =====");

  const client = axios.create({
    baseURL: API_URL,
    timeout: 15000,
    validateStatus: () => true
  });

  console.log("\nRealizando login dos usuários...");

  const sessoes = await Promise.all(carregarUsuariosStress().map(login));

  sessoes.forEach((s) => {
    console.log(
      `${s.tipo}: login OK - ${s.tempoLoginMs.toFixed(2)}ms`
    );
  });

  const tempos = [];
  const statusCodes = {};
  const porPerfil = {};

  let sucesso = 0;
  let erro = 0;
  let timeout = 0;

  for (const usuario of USUARIOS) {
    porPerfil[usuario.tipo] = {
      sucesso: 0,
      erro: 0,
      tempos: []
    };
  }

  async function requisicao(numero) {
    const sessao = escolherSessao(sessoes, numero);
    const start = process.hrtime.bigint();

    try {
      const res = await client.get("/auth/me", {
        headers: {
          Cookie: sessao.cookieHeader
        }
      });

      const tempo = diffMs(start);

      tempos.push(tempo);
      porPerfil[sessao.tipo].tempos.push(tempo);

      statusCodes[res.status] = (statusCodes[res.status] || 0) + 1;

      if (res.status < 400) {
        sucesso++;
        porPerfil[sessao.tipo].sucesso++;
      } else {
        erro++;
        porPerfil[sessao.tipo].erro++;
      }

      if (numero % 100 === 0) {
        console.log(
          `#${numero} | ${sessao.tipo} | status ${res.status} | ${tempo.toFixed(2)}ms`
        );
      }
    } catch (err) {
      erro++;
      porPerfil[sessao.tipo].erro++;

      if (err.code === "ECONNABORTED") {
        timeout++;
      }
    }
  }

  const inicioTotal = process.hrtime.bigint();

  for (let i = 0; i < CONFIG.totalRequests; i += CONFIG.concurrentUsers) {
    const lote = [];

    for (let j = 0; j < CONFIG.concurrentUsers; j++) {
      const numero = i + j + 1;

      if (numero <= CONFIG.totalRequests) {
        lote.push(requisicao(numero));
      }
    }

    await Promise.all(lote);
    await sleep(CONFIG.delayBetweenBatchesMs);
  }

  const tempoTotalSegundos = diffMs(inicioTotal) / 1000;
  const rps = CONFIG.totalRequests / tempoTotalSegundos;
  const metricas = calcularMetricas(tempos);

  console.log("\n===== RESULTADO GERAL =====");
  console.log("Total de requisições:", CONFIG.totalRequests);
  console.log("Usuários simultâneos:", CONFIG.concurrentUsers);
  console.log("Sucesso:", sucesso);
  console.log("Erros:", erro);
  console.log("Timeouts:", timeout);
  console.log("Status codes:", statusCodes);
  console.log("Tempo total:", `${tempoTotalSegundos.toFixed(2)}s`);
  console.log("RPS:", rps.toFixed(2));

  console.log("\n===== TEMPOS GERAIS =====");
  console.log("Mínimo:", `${metricas.min.toFixed(2)}ms`);
  console.log("Média:", `${metricas.media.toFixed(2)}ms`);
  console.log("P90:", `${metricas.p90.toFixed(2)}ms`);
  console.log("P95:", `${metricas.p95.toFixed(2)}ms`);
  console.log("P99:", `${metricas.p99.toFixed(2)}ms`);
  console.log("Máximo:", `${metricas.max.toFixed(2)}ms`);

  console.log("\n===== RESULTADO POR PERFIL =====");

  for (const [tipo, dados] of Object.entries(porPerfil)) {
    const m = calcularMetricas(dados.tempos);

    console.log(`\n${tipo.toUpperCase()}`);
    console.log("Sucesso:", dados.sucesso);
    console.log("Erros:", dados.erro);
    console.log("Média:", `${m.media.toFixed(2)}ms`);
    console.log("P95:", `${m.p95.toFixed(2)}ms`);
    console.log("Máximo:", `${m.max.toFixed(2)}ms`);
  }

  console.log("\n===== DIAGNÓSTICO =====");

  if (erro > CONFIG.totalRequests * 0.05) {
    console.log("Resultado: ruim. Muitos erros durante carga.");
  } else if (metricas.p95 < 800) {
    console.log("Resultado: bom. Aguenta bem uso simultâneo normal.");
  } else if (metricas.p95 < 1500) {
    console.log("Resultado: aceitável. Pode usar, mas vale otimizar depois.");
  } else {
    console.log("Resultado: lento sob carga. Verifique banco, índices e chamadas repetidas.");
  }
}

main().catch((err) => {
  console.log("Erro ao executar teste:", err.message);
});
