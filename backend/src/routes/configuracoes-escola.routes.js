const express = require("express");
const router = express.Router();
const controller = require("../controllers/configuracoesEscolaController");
const { autenticar, autorizar } = require("../middlewares/authMiddleware");
const { auditarMutacao } = require("../middlewares/auditoriaMiddleware");

router.use(autenticar);
router.get("/", autorizar("professor", "pedagoga", "administracao"), controller.obterConfiguracao);
router.put("/", autorizar("administracao"), auditarMutacao({
  acao: "CONFIGURACAO_ADMINISTRATIVA_EDITADA",
  entidade: "configuracao",
  entidadeId: "1",
  descricao: "Atualizou uma configuração administrativa da escola.",
  detalhes: ({ req }) => ({
    horario_limite_atraso: req.body.horario_limite_atraso ?? req.body.horarioLimiteAtraso,
    tempo_maximo_justificativas_meses: req.body.tempo_maximo_justificativas_meses ?? req.body.tempoMaximoJustificativasMeses,
    bloquear_edicao_chamadas_apos_horario: req.body.bloquear_edicao_chamadas_apos_horario ?? req.body.bloquearEdicaoChamadasAposHorario,
  }),
}), controller.salvarConfiguracao);

module.exports = router;
