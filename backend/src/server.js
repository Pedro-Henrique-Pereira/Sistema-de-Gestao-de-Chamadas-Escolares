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

const authRoutes = require("./routes/auth.routes");
const registrosRoutes = require("./routes/registros.routes");
const chamadasRoutes = require("./routes/chamadas.routes");
const usuariosRoutes = require("./routes/usuarios.routes");
const pedagogaRoutes = require("./routes/pedagoga.routes");
const adminRoutes = require("./routes/admin.routes");
const relatoriosRoutes = require("./routes/relatorios.routes");
const configuracoesEscolaRoutes = require("./routes/configuracoes-escola.routes");
const mensagensRoutes = require("./routes/mensagens.routes");
const automacaoRoutes = require("./routes/automacao.routes");
const { csrfProtection } = require("./middlewares/csrfMiddleware");
const { securityHeaders } = require("./middlewares/securityHeaders");
const { errorMiddleware, notFoundMiddleware } = require("./utils/errorHandler");
const { iniciarRotinaLimpezaDiaria } = require("./services/limpezaDadosService");
const { iniciarRotinaLimpezaAutomacao } = require("./services/limpezaAutomacaoService");
const { iniciarRotinaLimpezaAuditoria } = require("./services/limpezaAuditoriaService");

const app = express();
app.disable("x-powered-by");

if (process.env.NODE_ENV === "production") {
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 1);
  app.set("trust proxy", trustProxyHops);
}

const FRONTEND_URL = process.env.FRONTEND_URL
  || (process.env.NODE_ENV === "production" ? "" : "http://192.168.0.13:5173");

const FRONTEND_URLS_EXTRAS = String(process.env.FRONTEND_URLS_EXTRAS || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const origensPermitidas = new Set([
  FRONTEND_URL,
  "https://www.lysimaco.com.br",
  "https://lysimaco.com.br",
  "https://sistema-de-gestao-de-chamadas-escol.vercel.app",
  ...FRONTEND_URLS_EXTRAS,
  ...(process.env.NODE_ENV === "production"
    ? []
    : [
        "http://localhost:5173",
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:4173",
      ]),
].filter(Boolean));

app.use(securityHeaders);

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        origensPermitidas.has(origin)
      ) {
        return callback(null, true);
      }

      const error = new Error("Origem não autorizada pelo CORS.");
      error.status = 403;
      return callback(error);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
    maxAge: 600,
  })
);

app.use(express.json({ limit: "512kb", type: "application/json" }));
app.use(cookieParser());
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
app.use("/api/automacao", automacaoRoutes);


app.get("/", (req, res) => {
  res.json({
    status: "Backend Sistema de Chamada online",
  });
});

app.use(notFoundMiddleware);
app.use(errorMiddleware);

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.BIND_HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
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
