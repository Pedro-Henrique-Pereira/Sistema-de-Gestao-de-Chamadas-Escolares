const express = require('express');
const router = express.Router();

const automacaoController = require('../controllers/automacaoController');
const { autenticar, autorizar } = require('../middlewares/authMiddleware');
const { auditarMutacao } = require('../middlewares/auditoriaMiddleware');

router.use(autenticar);
router.use(autorizar('pedagoga', 'administracao'));

router.get('/status/:id', automacaoController.consultarStatus);
router.post('/cancelar/:id', auditarMutacao({
  acao: 'AUTOMACAO_CANCELADA', entidade: 'automacao', entidadeId: ({ req }) => req.params.id,
  descricao: 'Cancelou uma automação administrativa pendente.',
}), automacaoController.cancelarAutomacao);

module.exports = router;
