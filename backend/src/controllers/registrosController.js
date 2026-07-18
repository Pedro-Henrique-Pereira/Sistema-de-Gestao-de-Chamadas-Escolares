const { formatarNome, formatarTurma } = require("../utils/formatadores");
const {
  validarNomeUsuario,
  validarEmailUsuario,
  validarSenhaUsuario,
  validarCargoEquipe,
  normalizarErroEmailDuplicado,
} = require("../utils/usuarioValidation");
const bcrypt = require('bcrypt');
const Registros = require('../models/registrosModel');


function validarTexto(valor, campo) {
  if (!valor || String(valor).trim().length < 2) {
    const erro = new Error(`${campo} é obrigatório.`);
    erro.status = 400;
    throw erro;
  }
  return String(valor).trim();
}

function montarPessoaEquipe(id, { nome, email, cargo, status = 'Ativo' }) {
  return {
    id: Number(id),
    nome,
    idade: '',
    cargo,
    email,
    status,
  };
}

async function listarTurmas(req, res, next) {
  try {
    res.json({ turmas: await Registros.listarTurmas() });
  } catch (error) {
    next(error);
  }
}

async function criarTurma(req, res, next) {
  try {
    const nomeTurma = formatarTurma(validarTexto(req.body.nome || req.body.nomeTurma, 'Nome da turma'));
    const turma = await Registros.criarTurma(nomeTurma);
    res.status(201).json({ turma });
  } catch (error) {
    next(error);
  }
}

async function atualizarTurma(req, res, next) {
  try {
    const nomeTurma = formatarTurma(validarTexto(req.body.nome || req.body.nomeTurma, 'Nome da turma'));
    const turma = await Registros.atualizarTurma(req.params.id, nomeTurma);
    res.json({ turma, turmas: await Registros.listarTurmas() });
  } catch (error) {
    next(error);
  }
}

async function removerTurma(req, res, next) {
  try {
    await Registros.removerTurma(req.params.id);

    const turmas = await Registros.listarTurmas();

    res.json({
      mensagem: 'Turma removida com sucesso. Os alunos ficaram sem turma.',
      turmas,
    });
  } catch (error) {
    next(error);
  }
}

async function listarAlunos(req, res, next) {
  try {
    const entrada = (req.method === 'POST' ? req.body : req.query) || {};

    if (req.method === 'GET' && req.query.busca) {
      return res.status(400).json({
        erro: 'Use a pesquisa protegida para buscar dados pessoais de alunos ou responsáveis.',
      });
    }

    const resultado = await Registros.listarAlunosPaginado({
      page: entrada.page,
      limit: entrada.limit,
      busca: entrada.busca,
    });

    res.json(resultado);
  } catch (error) {
    next(error);
  }
}

async function criarAluno(req, res, next) {
  try {
    const nome = formatarNome(validarTexto(req.body.nome, 'Nome do aluno'));
    const idade = Number(req.body.idade);
    if (!Number.isInteger(idade) || idade <= 0) {
      return res.status(400).json({ erro: 'Idade inválida.' });
    }
    const responsavelRecebido = req.body.responsaveis?.[0] || {
      nome: req.body.responsavel,
      parentesco: req.body.parentesco,
      contato: req.body.contato,
    };

    const dadosAluno = {
      nome,
      idade,
      turma_id: req.body.turma_id ? Number(req.body.turma_id) : null,
      turma: req.body.turma ? formatarTurma(req.body.turma) : '',
      __turmaEnviada: Object.prototype.hasOwnProperty.call(req.body, 'turma_id') || Object.prototype.hasOwnProperty.call(req.body, 'turma'),
      responsaveis: responsavelRecebido.nome
        ? [{
            ...responsavelRecebido,
            nome: formatarNome(responsavelRecebido.nome),
          }]
        : [],
    };

    await Registros.criarAluno(dadosAluno);
    res.status(201).json({ mensagem: 'Aluno criado com sucesso.' });
  } catch (error) {
    next(error);
  }
}

async function atualizarAluno(req, res, next) {
  try {
    const nome = formatarNome(validarTexto(req.body.nome, 'Nome do aluno'));
    const idade = Number(req.body.idade);
    if (!Number.isInteger(idade) || idade <= 0) {
      return res.status(400).json({ erro: 'Idade inválida.' });
    }
    const responsavelRecebido = req.body.responsaveis?.[0] || {
      nome: req.body.responsavel,
      parentesco: req.body.parentesco,
      contato: req.body.contato,
    };

    const dadosAluno = {
      nome,
      idade,
      turma_id: req.body.turma_id ? Number(req.body.turma_id) : null,
      turma: req.body.turma ? formatarTurma(req.body.turma) : '',
      __turmaEnviada: Object.prototype.hasOwnProperty.call(req.body, 'turma_id') || Object.prototype.hasOwnProperty.call(req.body, 'turma'),
      responsaveis: responsavelRecebido.nome
        ? [{
            ...responsavelRecebido,
            nome: formatarNome(responsavelRecebido.nome),
          }]
        : [],
    };

    await Registros.atualizarAluno(req.params.id, dadosAluno);
    res.json({ mensagem: 'Aluno atualizado com sucesso.' });
  } catch (error) {
    next(error);
  }
}

async function atualizarTurmaAluno(req, res, next) {
  try {
    const turma = req.body.turma ? formatarTurma(req.body.turma) : '';
    await Registros.atualizarTurmaAluno(req.params.id, turma);
    res.json({ mensagem: 'Turma do aluno atualizada com sucesso.' });
  } catch (error) {
    next(error);
  }
}

async function removerAluno(req, res, next) {
  try {
    await Registros.removerAluno(req.params.id);
    res.json({ mensagem: 'Aluno removido com sucesso.' });
  } catch (error) {
    next(error);
  }
}

async function listarEquipe(req, res, next) {
  try {
    res.json({ equipe: await Registros.listarEquipe() });
  } catch (error) {
    next(error);
  }
}

async function criarEquipe(req, res, next) {
  try {
    const nome = validarNomeUsuario(req.body.nome);
    const email = validarEmailUsuario(req.body.email);
    const senha = validarSenhaUsuario(req.body.senha, { obrigatoria: true });
    const { cargo } = validarCargoEquipe(req.body.cargo);
    const senhaHash = await bcrypt.hash(senha, 10);
    const id = await Registros.criarEquipe({ nome, email, senhaHash, cargo });
    res.status(201).json({
      mensagem: 'Conta criada com sucesso.',
      pessoa: montarPessoaEquipe(id, { nome, email, cargo }),
    });
  } catch (error) {
    next(normalizarErroEmailDuplicado(error));
  }
}

async function atualizarEquipe(req, res, next) {
  try {
    const nome = validarNomeUsuario(req.body.nome);
    const email = validarEmailUsuario(req.body.email);
    const { cargo } = validarCargoEquipe(req.body.cargo);
    const senha = validarSenhaUsuario(req.body.senha);
    const senhaHash = senha ? await bcrypt.hash(senha, 10) : null;
    await Registros.atualizarEquipe(req.params.id, {
      nome,
      email,
      senhaHash,
      cargo,
      status: req.body.status,
    });
    res.json({
      mensagem: 'Conta atualizada com sucesso.',
      pessoa: montarPessoaEquipe(req.params.id, {
        nome,
        email,
        cargo,
        status: req.body.status || 'Ativo',
      }),
    });
  } catch (error) {
    next(normalizarErroEmailDuplicado(error));
  }
}

async function removerEquipe(req, res, next) {
  try {
    if (Number(req.params.id) === Number(req.usuario.id)) {
      return res.status(400).json({ erro: 'Você não pode remover sua própria conta logada.' });
    }
    await Registros.removerEquipe(req.params.id);
    res.json({ mensagem: 'Conta removida com sucesso.', id: Number(req.params.id) });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listarTurmas,
  criarTurma,
  atualizarTurma,
  removerTurma,
  listarAlunos,
  criarAluno,
  atualizarAluno,
  atualizarTurmaAluno,
  removerAluno,
  listarEquipe,
  criarEquipe,
  atualizarEquipe,
  removerEquipe,
};
