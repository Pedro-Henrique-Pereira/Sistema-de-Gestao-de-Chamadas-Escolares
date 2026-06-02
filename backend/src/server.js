require("dotenv").config({ path: "config.env" });

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
const { errorMiddleware } = require("./utils/errorHandler");
const { iniciarRotinaLimpezaDiaria } = require("./services/limpezaDadosService");
const { iniciarRotinaLimpezaAutomacao } = require("./services/limpezaAutomacaoService");

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || "http://192.168.0.13:5173";
const FRONTEND_URLS_EXTRAS = String(process.env.FRONTEND_URLS_EXTRAS || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const origensPermitidas = new Set([
  FRONTEND_URL,
  "http://192.168.0.13:5173",
  "http://192.168.0.13:4173",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...FRONTEND_URLS_EXTRAS,
]);

function origemRedeLocalPermitida(origin = "") {
  return /^http:\/\/192\.168\.0\.\d{1,3}:(5173|4173)$/.test(origin);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origensPermitidas.has(origin) || origemRedeLocalPermitida(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origem não autorizada pelo CORS: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));
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

app.use(errorMiddleware);

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.BIND_HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
  console.log(`Acesso pela rede local: http://192.168.0.13:${PORT}`);

  if (process.env.DISABLE_DAILY_CLEANUP !== "true") {
    iniciarRotinaLimpezaDiaria();
  }

  if (process.env.DISABLE_AUTOMACAO_CLEANUP !== "true") {
    iniciarRotinaLimpezaAutomacao();
  }
});