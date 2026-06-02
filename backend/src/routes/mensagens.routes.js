const express = require('express');
const router = express.Router();

const mensagensController = require('../controllers/mensagensController');
const { autenticar, autorizar } = require('../middlewares/authMiddleware');

router.use(autenticar);
router.use(autorizar('administracao'));

router.get('/grupos', mensagensController.listarGrupos);
router.post('/grupos', mensagensController.criarGrupo);
router.put('/grupos/:id', mensagensController.atualizarGrupo);
router.delete('/grupos/:id', mensagensController.removerGrupo);
router.get('/preferencias', mensagensController.obterPreferencias);
router.put('/preferencias', mensagensController.salvarPreferencias);
router.post('/enviar', mensagensController.enviarMensagem);
router.post('/limpar-tarefas-antigas', mensagensController.limparTarefasAntigas);

module.exports = router;
