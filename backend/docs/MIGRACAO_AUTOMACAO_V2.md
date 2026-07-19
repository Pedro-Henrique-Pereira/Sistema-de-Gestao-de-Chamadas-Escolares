# Diagnóstico e migração da automação V2

## Fluxo encontrado antes da migração

O sistema web possuía três contratos sobrepostos:

1. `POST /api/pedagoga/automacao-whatsapp/solicitar` criava uma tarefa genérica
   de faltas do dia em `fila_automacao`.
2. `POST /api/mensagens/enviar` criava uma linha de fila para cada grupo.
3. `/api/automacao/status/:id` e `/api/automacao/cancelar/:id` expunham apenas
   o estado geral, sem destinatários, progresso ou disponibilidade da máquina.

O aplicativo desktop já não acessava o MySQL, mas a API de worker materializava
os destinatários apenas durante a captura. Não existiam heartbeat, versão mínima
do aplicativo, posição na fila, resultado público por destinatário ou bloqueio
central que impedisse duas instâncias da mesma máquina de avançarem em paralelo.

No banco local analisado havia tarefas persistidas do formato anterior. Elas
serão preservadas e drenadas pelo worker; nenhum histórico será apagado pela
migração.

## Itens removidos

- controlador e rota genéricos antigos de automação;
- endpoints de criação/status acoplados ao controlador da Pedagoga;
- endpoint administrativo antigo que criava uma tarefa por grupo;
- serviço `filaAutomacaoService`, usado somente pelo fluxo anterior;
- tabela `controle_envios_diarios`, substituída pela idempotência por tarefa e
  destinatário em `automacao_entregas`;
- documentação de uma migração antiga que não existe neste repositório.

## Itens reaproveitados

- `fila_automacao` como fonte central e persistente da fila;
- `automacao_entregas` como checkpoint individual;
- `grupos_whatsapp` e `config_mensagem_whatsapp`;
- autenticação web, RBAC, CSRF e auditoria administrativa;
- Selenium e perfil local do WhatsApp no aplicativo desktop;
- journal local de confirmações para fechar a janela entre envio e resposta.

## Contrato final

O navegador usa somente endpoints autenticados do backend:

- `POST /api/automation/tasks/attendance-notifications`;
- `POST /api/automation/tasks/group-messages`;
- `GET /api/automation/tasks/:id`;
- `GET /api/automation/machines`;
- `GET /api/automation/queues`;
- `POST /api/automation/tasks/:id/cancel`.

O aplicativo desktop inicia todas as conexões e usa somente:

- `POST /api/automation-worker/heartbeat`;
- `POST /api/automation-worker/tasks/claim`;
- `POST /api/automation-worker/deliveries/:id/result`.

Cada máquina possui token exclusivo. O backend associa o token a exatamente uma
máquina e rejeita credenciais duplicadas ou tentativa de operar outra fila.

## Regras preservadas

- faltas partem exclusivamente de `registros_chamadas_confirmadas` e
  `registros_frequencia_alunos`;
- Pedagoga usa máquinas 1 e 2;
- mensagens administrativas para grupos usam máquinas 3, 4 e 5;
- a fila é FIFO por máquina e uma máquina não bloqueia as demais;
- falhas individuais não interrompem os outros destinatários;
- tokens, cookies e credenciais nunca são retornados ao frontend.
