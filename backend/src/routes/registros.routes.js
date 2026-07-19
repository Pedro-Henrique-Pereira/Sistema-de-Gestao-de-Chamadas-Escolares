const express = require('express');
const router = express.Router();

const controller = require('../controllers/registrosController');
const { autenticar, autorizar } = require('../middlewares/authMiddleware');
const { auditarMutacao } = require('../middlewares/auditoriaMiddleware');

router.use(autenticar);
router.use(autorizar('administracao'));

router.get('/turmas', controller.listarTurmas);
router.post('/turmas', auditarMutacao({
  acao: 'TURMA_CRIADA', entidade: 'turma',
  entidadeId: ({ payload }) => payload.turma.id,
  descricao: ({ req }) => `Criou a turma ${req.body.nome || req.body.nomeTurma || ''}.`,
}), controller.criarTurma);
router.put('/turmas/:id', auditarMutacao({
  acao: 'TURMA_EDITADA', entidade: 'turma', entidadeId: ({ req }) => req.params.id,
  descricao: ({ req }) => `Atualizou os dados da turma ${req.body.nome || req.body.nomeTurma || req.params.id}.`,
}), controller.atualizarTurma);
router.delete('/turmas/:id', auditarMutacao({
  acao: 'TURMA_EXCLUIDA', entidade: 'turma', entidadeId: ({ req }) => req.params.id,
  descricao: 'Excluiu uma turma e preservou os alunos sem vínculo de turma.',
}), controller.removerTurma);

router.get('/alunos', controller.listarAlunos);
router.post('/alunos/pesquisar', controller.listarAlunos);
router.post('/alunos', auditarMutacao({
  acao: 'ALUNO_CRIADO', entidade: 'aluno',
  descricao: ({ req }) => `Criou o cadastro do aluno ${req.body.nome || ''}.`,
  detalhes: ({ req }) => ({ turma_id: req.body.turma_id || null }),
}), controller.criarAluno);
router.put('/alunos/:id', auditarMutacao({
  acao: 'ALUNO_EDITADO', entidade: 'aluno', entidadeId: ({ req }) => req.params.id,
  descricao: ({ req }) => `Atualizou o cadastro do aluno ${req.body.nome || req.params.id}.`,
  detalhes: ({ req }) => ({ turma_id: req.body.turma_id || null }),
}), controller.atualizarAluno);
router.patch('/alunos/:id/turma', auditarMutacao({
  acao: 'ALUNO_TURMA_ALTERADA', entidade: 'aluno', entidadeId: ({ req }) => req.params.id,
  descricao: 'Alterou a turma vinculada ao aluno.',
  detalhes: ({ req }) => ({ turma: req.body.turma || null }),
}), controller.atualizarTurmaAluno);
router.delete('/alunos/:id', auditarMutacao({
  acao: 'ALUNO_EXCLUIDO', entidade: 'aluno', entidadeId: ({ req }) => req.params.id,
  descricao: 'Excluiu um cadastro de aluno.',
}), controller.removerAluno);

router.get('/equipe', controller.listarEquipe);
router.post('/equipe', auditarMutacao({
  acao: 'USUARIO_CRIADO', entidade: 'usuario',
  entidadeId: ({ payload }) => payload.pessoa.id,
  descricao: ({ req }) => `Criou o usuário ${req.body.nome || ''} com perfil ${req.body.cargo || ''}.`,
  detalhes: ({ req }) => ({ perfil: req.body.cargo, ativo: true }),
}), controller.criarEquipe);
router.put('/equipe/:id', auditarMutacao({
  acao: 'USUARIO_EDITADO', entidade: 'usuario', entidadeId: ({ req }) => req.params.id,
  descricao: ({ req }) => req.body.senha
    ?
     'Atualizou o cadastro e alterou a senha do usuário. Nenhum dado da senha foi armazenado.'
    : 'Atualizou o cadastro, perfil ou estado do usuário.',
  detalhes: ({ req }) => ({ perfil: req.body.cargo, status: req.body.status, senha_alterada: Boolean(req.body.senha) }),
}), controller.atualizarEquipe);
router.delete('/equipe/:id', auditarMutacao({
  acao: 'USUARIO_EXCLUIDO', entidade: 'usuario', entidadeId: ({ req }) => req.params.id,
  descricao: 'Excluiu um usuário da equipe.',
}), controller.removerEquipe);

module.exports = router;
