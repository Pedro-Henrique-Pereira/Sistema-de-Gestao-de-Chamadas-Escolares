# Migração: Grupos Escolares + Mensagens da Administração

Arquivo principal:

```txt
backend/src/database/migrations/2026-05-31_grupos_escolares_mensagens_admin.sql
```

## O que esta migração faz

1. Adiciona `grupo_escolar` opcional em `turmas`.
2. Adiciona `maquina_padrao_mensagens` em `usuarios`, para salvar a preferência por conta.
3. Expande `fila_automacao` para suportar mensagens personalizadas por grupo escolar.
4. Cria índices para reduzir lentidão em busca por grupo e captura por máquina.
5. Cria limpeza automática de tarefas antigas da fila.

## Como executar no MySQL Workbench

1. Abra o arquivo SQL.
2. Confirme que o banco correto é `Sistema_Chamada`.
3. Execute o script inteiro.
4. Se o MySQL bloquear o agendador de eventos, execute com usuário administrador:

```sql
SET GLOBAL event_scheduler = ON;
```

Depois rode novamente o trecho que cria o evento, se necessário.

## Limpeza automática criada

A procedure `sp_limpar_fila_automacao_antiga()` aplica estas regras:

- tarefas `executando` travadas há mais de 30 minutos voltam para `pendente`;
- tarefas `pendente` há mais de 7 dias viram `expirado`;
- tarefas `concluido`, `erro` ou `expirado` há mais de 30 dias são removidas.

O evento `evt_limpar_fila_automacao_antiga` executa essa limpeza a cada 1 hora.

## Observação importante

Este pacote não altera frontend, backend controller/rotas nem automação Python. Ele prepara somente o banco de dados, conforme solicitado.
