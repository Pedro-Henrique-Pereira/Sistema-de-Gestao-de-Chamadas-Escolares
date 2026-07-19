const express = require("express");
const router = express.Router();

const usuariosConfigController = require("../controllers/usuariosConfigController");
const { autenticar } = require("../middlewares/authMiddleware");
const { auditarMutacao } = require("../middlewares/auditoriaMiddleware");

router.put("/configurar", autenticar, auditarMutacao({
  acao: ({ req }) => req.body.senha ? "ALTERACAO_SENHA" : "CONTA_EDITADA",
  entidade: "usuario",
  entidadeId: ({ req }) => req.usuario.id,
  descricao: ({ req }) => req.body.senha
    ?
     "Alterou os dados da própria conta e a senha. Nenhum dado da senha foi armazenado."
    : "Alterou os dados cadastrais da própria conta.",
  detalhes: ({ req }) => ({ senha_alterada: Boolean(req.body.senha) }),
}), usuariosConfigController.configurar);

module.exports = router;
