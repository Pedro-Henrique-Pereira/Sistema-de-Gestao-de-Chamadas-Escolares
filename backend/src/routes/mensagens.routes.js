const express = require('express');
const router = express.Router();

const mensagensController = require('../controllers/mensagensController');
const { autenticar, autorizar } = require('../middlewares/authMiddleware');
const { auditarMutacao } = require('../middlewares/auditoriaMiddleware');

router.use(autenticar);
router.use(autorizar('administracao'));

router.get('/grupos', mensagensController.listarGrupos);
router.post('/grupos', auditarMutacao({
  acao: 'GRUPO_MENSAGEM_CRIADO', entidade: 'grupo_mensagem',
  entidadeId: ({ payload }) => payload.grupo.id || payload.id,
  descricao: ({ req }) => `Criou o grupo de mensagens ${req.body.nome || req.body.nome_grupo || ''}.`,
}), mensagensController.criarGrupo);
router.put('/grupos/:id', auditarMutacao({
  acao: 'GRUPO_MENSAGEM_EDITADO', entidade: 'grupo_mensagem', entidadeId: ({ req }) => req.params.id,
  descricao: 'Atualizou um grupo de mensagens ou seu estado de ativação.',
  detalhes: ({ req }) => ({ ativo: req.body.ativo }),
}), mensagensController.atualizarGrupo);
router.delete('/grupos/:id', auditarMutacao({
  acao: 'GRUPO_MENSAGEM_EXCLUIDO', entidade: 'grupo_mensagem', entidadeId: ({ req }) => req.params.id,
  descricao: 'Excluiu um grupo de mensagens.',
}), mensagensController.removerGrupo);
router.get('/preferencias', mensagensController.obterPreferencias);
router.put('/preferencias', auditarMutacao({
  acao: 'PREFERENCIA_MENSAGENS_EDITADA', entidade: 'configuracao', entidadeId: 'mensagens',
  descricao: 'Atualizou preferências administrativas de mensagens.',
  detalhes: ({ req }) => ({ maquina: req.body.maquina || req.body.maquinaDestino }),
}), mensagensController.salvarPreferencias);
module.exports = router;
