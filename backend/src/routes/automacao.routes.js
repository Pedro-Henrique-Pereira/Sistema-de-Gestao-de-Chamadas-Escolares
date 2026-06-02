const express = require('express');
const router = express.Router();

const automacaoController = require('../controllers/automacaoController');
const { autenticar, autorizar } = require('../middlewares/authMiddleware');

router.use(autenticar);
router.use(autorizar('pedagoga', 'administracao'));

router.get('/status/:id', automacaoController.consultarStatus);
router.post('/cancelar/:id', automacaoController.cancelarAutomacao);

module.exports = router;
