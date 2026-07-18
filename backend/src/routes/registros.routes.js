const express = require('express');
const router = express.Router();

const controller = require('../controllers/registrosController');
const { autenticar, autorizar } = require('../middlewares/authMiddleware');

router.use(autenticar);
router.use(autorizar('administracao'));

router.get('/turmas', controller.listarTurmas);
router.post('/turmas', controller.criarTurma);
router.put('/turmas/:id', controller.atualizarTurma);
router.delete('/turmas/:id', controller.removerTurma);

router.get('/alunos', controller.listarAlunos);
router.post('/alunos/pesquisar', controller.listarAlunos);
router.post('/alunos', controller.criarAluno);
router.put('/alunos/:id', controller.atualizarAluno);
router.patch('/alunos/:id/turma', controller.atualizarTurmaAluno);
router.delete('/alunos/:id', controller.removerAluno);

router.get('/equipe', controller.listarEquipe);
router.post('/equipe', controller.criarEquipe);
router.put('/equipe/:id', controller.atualizarEquipe);
router.delete('/equipe/:id', controller.removerEquipe);

module.exports = router;
