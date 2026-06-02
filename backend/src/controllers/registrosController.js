const { formatarNome, formatarTurma, formatarEmail } = require("../utils/formatadores");
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

async function listarDados(req, res, next) {
  try {
    const [turmas, alunos, equipe] = await Promise.all([
      Registros.listarTurmas(),
      Registros.listarAlunos(),
      Registros.listarEquipe(),
    ]);

    res.json({ turmas, alunos, equipe });
  } catch (error) {
    next(error);
  }
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

    const [turmas, alunos] = await Promise.all([
      Registros.listarTurmas(),
      Registros.listarAlunos(),
    ]);

    res.json({
      mensagem: 'Turma removida com sucesso. Os alunos ficaram sem turma.',
      turmas,
      alunos,
    });
  } catch (error) {
    next(error);
  }
}

async function listarAlunos(req, res, next) {
  try {
    res.json({ alunos: await Registros.listarAlunos() });
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
      ...req.body,
      nome,
      idade,
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
    res.status(201).json({ alunos: await Registros.listarAlunos() });
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
      ...req.body,
      nome,
      idade,
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
    res.json({ alunos: await Registros.listarAlunos() });
  } catch (error) {
    next(error);
  }
}

async function atualizarTurmaAluno(req, res, next) {
  try {
    const turma = req.body.turma ? formatarTurma(req.body.turma) : '';
    await Registros.atualizarTurmaAluno(req.params.id, turma);
    res.json({ alunos: await Registros.listarAlunos() });
  } catch (error) {
    next(error);
  }
}

async function removerAluno(req, res, next) {
  try {
    await Registros.removerAluno(req.params.id);
    res.json({ alunos: await Registros.listarAlunos() });
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
    const nome = formatarNome(validarTexto(req.body.nome, 'Nome'));
    const email = formatarEmail(validarTexto(req.body.email, 'Email'));
    const senha = validarTexto(req.body.senha, 'Senha');
    const cargo = validarTexto(req.body.cargo, 'Cargo');
    const senhaHash = await bcrypt.hash(senha, 10);
    await Registros.criarEquipe({ nome, email, senhaHash, cargo });
    res.status(201).json({ equipe: await Registros.listarEquipe() });
  } catch (error) {
    next(error);
  }
}

async function atualizarEquipe(req, res, next) {
  try {
    const nome = formatarNome(validarTexto(req.body.nome, 'Nome'));
    const email = formatarEmail(validarTexto(req.body.email, 'Email'));
    const cargo = validarTexto(req.body.cargo, 'Cargo');
    const senha = String(req.body.senha || '').trim();
    const senhaHash = senha ? await bcrypt.hash(senha, 10) : null;
    await Registros.atualizarEquipe(req.params.id, {
      nome,
      email,
      senhaHash,
      cargo,
      status: req.body.status,
    });
    res.json({ equipe: await Registros.listarEquipe() });
  } catch (error) {
    next(error);
  }
}

async function removerEquipe(req, res, next) {
  try {
    if (Number(req.params.id) === Number(req.usuario.id)) {
      return res.status(400).json({ erro: 'Você não pode remover sua própria conta logada.' });
    }
    await Registros.removerEquipe(req.params.id);
    res.json({ equipe: await Registros.listarEquipe() });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listarDados,
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
