require("dotenv").config({ path: "config.env" });
process.env.TZ = process.env.TZ || "America/Sao_Paulo";

function validarConfiguracoesCriticas() {
  const ambienteProducao = process.env.NODE_ENV === "production";

  if (ambienteProducao && process.env.AUTH_DEV_BYPASS === "true") {
    throw new Error("CRITICAL SECURITY ERROR: AUTH_DEV_BYPASS não pode estar ativo em ambiente de produção.");
  }

  if (ambienteProducao && process.env.DEV_LOGIN_ENABLED === "true") {
    throw new Error("CRITICAL SECURITY ERROR: DEV_LOGIN_ENABLED não pode estar ativo em ambiente de produção.");
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error(
      "CRITICAL CONFIG ERROR: JWT_SECRET ausente ou muito fraco. Configure uma chave segura com pelo menos 32 caracteres."
    );
  }
}

validarConfiguracoesCriticas();


const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const pool = require("./database/db");

const authRoutes = require("./routes/auth.routes");
const registrosRoutes = require("./routes/registros.routes");
const chamadasRoutes = require("./routes/chamadas.routes");
const usuariosRoutes = require("./routes/usuarios.routes");
const pedagogaRoutes = require("./routes/pedagoga.routes");
const adminRoutes = require("./routes/admin.routes");
const relatoriosRoutes = require("./routes/relatorios.routes");
const configuracoesEscolaRoutes = require("./routes/configuracoes-escola.routes");
const mensagensRoutes = require("./routes/mensagens.routes");
const automationRoutes = require("./routes/automation.routes");
const automationWorkerRoutes = require("./routes/automation-worker.routes");
const { csrfProtection } = require("./middlewares/csrfMiddleware");
const { securityHeaders } = require("./middlewares/securityHeaders");
const { errorMiddleware, notFoundMiddleware } = require("./utils/errorHandler");
const { health, ready } = require("./controllers/healthController");
const {
  obterOrigensPermitidas,
  origemCorsPermitida,
  obterTrustProxy,
} = require("./config/runtimeConfig");
const { iniciarRotinaLimpezaDiaria } = require("./services/limpezaDadosService");
const { iniciarRotinaLimpezaAutomacao } = require("./services/limpezaAutomacaoService");
const { iniciarRotinaLimpezaAuditoria } = require("./services/limpezaAuditoriaService");

const app = express();
app.disable("x-powered-by");

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", obterTrustProxy());
}

const origensPermitidas = obterOrigensPermitidas();

app.use(securityHeaders);

app.use(
  cors({
    origin(origin, callback) {
      if (origemCorsPermitida(origin, origensPermitidas)) {
        return callback(null, true);
      }

      const error = new Error("Origem não autorizada pelo CORS.");
      error.status = 403;
      return callback(error);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "Authorization", "X-Automation-Machine"],
    maxAge: 600,
  })
);

app.use(express.json({ limit: "512kb", type: "application/json" }));
app.use(cookieParser());
app.get("/api/health", health);
app.get("/api/ready", ready);
// Integração servidor-a-servidor: token Bearer dedicado, sem cookies de usuário.
// A rota é montada antes do CSRF porque não usa autenticação baseada em navegador.
app.use("/api/automation-worker", automationWorkerRoutes);
app.use(csrfProtection);

app.use("/api/auth", authRoutes);
app.use("/api/registros", registrosRoutes);
app.use("/api/chamadas", chamadasRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/pedagoga", pedagogaRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/relatorios", relatoriosRoutes);
app.use("/api/configuracoes-escola", configuracoesEscolaRoutes);
app.use("/api/mensagens", mensagensRoutes);
app.use("/api/automation", automationRoutes);


app.get("/", (req, res) => {
  res.json({
    status: "Backend Sistema de Chamada online",
  });
});

app.use(notFoundMiddleware);
app.use(errorMiddleware);

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.BIND_HOST || "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  if (process.env.DISABLE_DAILY_CLEANUP !== "true") {
    iniciarRotinaLimpezaDiaria();
  }

  if (process.env.DISABLE_AUTOMACAO_CLEANUP !== "true") {
    iniciarRotinaLimpezaAutomacao();
  }

  if (process.env.DISABLE_AUDIT_CLEANUP !== "true") {
    iniciarRotinaLimpezaAuditoria();
  }
});

let encerramentoIniciado = false;

function encerrarComSeguranca(signal) {
  if (encerramentoIniciado) return;
  encerramentoIniciado = true;

  const limite = setTimeout(() => {
    console.error(`Encerramento forcado apos timeout. signal=${signal}`);
    process.exit(1);
  }, 10000);
  limite.unref();

  server.close(async (serverError) => {
    let exitCode = serverError ? 1 : 0;

    try {
      await pool.end();
    } catch {
      exitCode = 1;
      console.error("Falha ao fechar o pool MySQL durante o encerramento.");
    } finally {
      clearTimeout(limite);
      process.exit(exitCode);
    }
  });
}

process.once("SIGTERM", () => encerrarComSeguranca("SIGTERM"));
process.once("SIGINT", () => encerrarComSeguranca("SIGINT"));
