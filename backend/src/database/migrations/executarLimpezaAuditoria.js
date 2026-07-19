const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../config.env") });
const { executarLimpezaAuditoria } = require("../../services/limpezaAuditoriaService");
const db = require("../../database/db");

const forcar = process.argv.includes("--force");

executarLimpezaAuditoria({ forcar })
  .then((resultado) => {
    console.log(JSON.stringify(resultado));
    process.exitCode = 0;
  })
  .catch(() => {
    console.error("A limpeza de auditoria falhou. Consulte os logs técnicos seguros do backend.");
    process.exitCode = 1;
  })
  .finally(() => db.end());
