const express = require("express");
const router = express.Router();

const chamadasController = require("../controllers/chamadasController");
const { autenticar, autorizar } = require("../middlewares/authMiddleware");
const { validarDatasRequest } = require("../utils/dateValidation");
const { auditarMutacao } = require("../middlewares/auditoriaMiddleware");

router.use(autenticar);
router.use(validarDatasRequest());

router.get("/verificar-turmas", autorizar("professor", "pedagoga", "administracao"), chamadasController.verificarTurmas);
router.get("/historico", autorizar("professor", "pedagoga", "administracao"), chamadasController.historico);
router.post("/", autorizar("professor"), auditarMutacao({
  acao: "CHAMADA_CRIADA", entidade: "chamada",
  entidadeId: ({ payload }) => payload.chamada.id || payload.id,
  descricao: ({ req }) => `Criou a chamada da turma ${req.body.turma_nome || req.body.turma || req.body.turma_id || "informada"}.`,
  detalhes: ({ req }) => ({ turma_id: req.body.turma_id, materia: req.body.materia, data_chamada: req.body.data_chamada }),
}), chamadasController.criar);
router.patch("/:id/atraso", autorizar("professor", "pedagoga", "administracao"), auditarMutacao({
  acao: "ALUNO_MARCADO_COMO_ATRASADO", entidade: "chamada", entidadeId: ({ req }) => req.params.id,
  descricao: ({ req }) => `Registrou atraso de aluno na chamada ${req.params.id}.`,
  detalhes: ({ req }) => ({ aluno_id: req.body.aluno_id || req.body.alunoId }),
}), chamadasController.marcarAtraso);
router.put("/:id", autorizar("professor"), auditarMutacao({
  acao: "CHAMADA_EDITADA", entidade: "chamada", entidadeId: ({ req }) => req.params.id,
  descricao: ({ req }) => `Atualizou a matéria e os registros de frequência de ${Array.isArray(req.body.alunos) ? req.body.alunos.length : 0} alunos na chamada ${req.params.id}.`,
  detalhes: ({ req }) => ({ total_alunos: Array.isArray(req.body.alunos) ? req.body.alunos.length : undefined }),
}), chamadasController.atualizar);

module.exports = router;
