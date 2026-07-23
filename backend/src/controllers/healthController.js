const pool = require("../database/db");

function health(req, res) {
  return res.status(200).json({ status: "ok" });
}

function criarReadyHandler(database = pool) {
  return async function ready(req, res) {
    try {
      await database.query("SELECT 1");
      return res.status(200).json({ status: "ready" });
    } catch {
      return res.status(503).json({ status: "unavailable" });
    }
  };
}

module.exports = {
  health,
  ready: criarReadyHandler(),
  criarReadyHandler,
};
