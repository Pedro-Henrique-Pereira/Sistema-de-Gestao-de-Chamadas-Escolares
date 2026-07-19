# Logs de Auditoria

## Estrutura

O sistema usa duas estruturas persistentes e separadas:

- `logs_auditoria`: trilha global imutável de operações relevantes, com autoria resolvida no backend, entidade, resultado, IP seguro e data do servidor.
- `auditoria_limpeza_estado`: metadado permanente da última limpeza, quantidade removida, próxima execução e trava de concorrência.

A API expõe somente consultas `GET` em `/api/admin/logs-auditoria` e `/api/admin/logs-auditoria/opcoes`. As duas rotas exigem autenticação e perfil `administracao`. Não existem rotas para criar, editar ou excluir logs.

## Privacidade

O responsável é obtido do usuário autenticado e novamente consultado no banco. A data, o resultado e o IP são determinados pelo servidor. O frontend não define esses campos.

Antes de persistir metadados, a sanitização central remove chaves relacionadas a senhas, hashes, tokens, cookies, CSRF, autorização, segredos, documentos, contatos, anexos e motivos de justificativas. O endpoint de consulta também não retorna o campo JSON `detalhes`.

## Retenção e limpeza

- Retenção padrão: 365 dias.
- Configuração opcional: `AUDIT_RETENTION_DAYS`, limitada entre 30 e 3650 dias.
- Periodicidade: a cada 30 dias, baseada em `proxima_execucao_em` no banco.
- Reinicialização: o backend verifica o estado persistente ao iniciar e depois a cada seis horas.
- Concorrência: uma trava MySQL (`GET_LOCK`) e a linha de estado com `FOR UPDATE` impedem execuções simultâneas, inclusive entre instâncias.
- Falhas: detalhes internos ficam apenas no log técnico seguro; o navegador não recebe stack trace.

A rotina remove somente `logs_auditoria.criado_em` anteriores à retenção. O aviso da última limpeza não é um log comum e, por isso, não é removido.

## Aplicação e teste manual

Antes de publicar o backend, aplique a migração no banco configurado:

```bash
npm run migrate:audit-logs
```

Para testar a limpeza sem esperar 30 dias:

```bash
npm run audit:cleanup -- --force
```

O comando forçado continua respeitando a retenção: registros recentes nunca são removidos. A saída informa se a rotina executou, quantos registros venceu e qual retenção foi usada.
