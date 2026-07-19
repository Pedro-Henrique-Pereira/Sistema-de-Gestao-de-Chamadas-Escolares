# API V2 de automação

## Arquitetura

O navegador conversa somente com o backend autenticado do Sistema de Chamadas.
O aplicativo desktop inicia conexões de saída para `/api/automation-worker`; ele
não acessa MySQL, cookies ou sessões de usuários.

```text
Navegador -> backend web -> fila persistente -> aplicativo desktop -> WhatsApp
                                      ^                  |
                                      +---- resultados --+
```

## Autenticação das máquinas

Configure `AUTOMATION_MACHINE_TOKENS` no backend como JSON. As cinco máquinas
devem existir, cada uma com credencial exclusiva de pelo menos 32 caracteres.
Máquinas 1 e 2 pertencem ao fluxo das pedagogas; Máquinas 3, 4 e 5 pertencem ao
fluxo dos administradores:

```env
AUTOMATION_MACHINE_TOKENS={"1":"token-exclusivo-maquina-1-troque-aqui","2":"token-exclusivo-maquina-2-troque-aqui","3":"token-exclusivo-maquina-3-troque-aqui","4":"token-exclusivo-maquina-4-troque-aqui","5":"token-exclusivo-maquina-5-troque-aqui"}
```

O aplicativo envia:

```http
Authorization: Bearer <token exclusivo>
X-Automation-Machine: 1
```

Uma credencial nunca pode consultar ou atualizar tarefas de outra máquina. A
comparação do segredo ocorre em tempo constante. A rota técnica não usa cookies
e é montada antes do CSRF; todas as rotas do navegador continuam protegidas.

## API usada pelo navegador

Todas as rotas abaixo exigem a sessão web e autorização no backend:

- `POST /api/automation/tasks/attendance-notifications`
  - pedagoga ou administrador;
  - apenas chamadas confirmadas;
  - Máquinas 1 ou 2;
  - cria uma entrega individual por aluno ausente.
- `POST /api/automation/tasks/group-messages`
  - somente administrador;
  - Máquinas 3, 4 ou 5;
  - cria uma tarefa com uma entrega individual por grupo.
- `GET /api/automation/tasks/:id`
  - retorna progresso, totais e falhas públicas por destinatário.
- `GET /api/automation/tasks`
  - lista tarefas visíveis ao usuário.
- `GET /api/automation/machines`
  - retorna heartbeat, estado, versão e fila.
- `GET /api/automation/queues`
  - somente administrador.
- `POST /api/automation/queues/:machineId/clear`
  - pedagoga: somente Máquinas 1 e 2;
  - administrador: somente Máquinas 3, 4 e 5;
  - retira da fila apenas tarefas `pendente`;
  - preserva tarefas `executando`, entregas finalizadas, eventos e auditoria.
- `POST /api/automation/tasks/:id/cancel`
  - somente administrador e apenas antes do início.
- `GET|PUT /api/automation/message-template`
  - lê ou altera o modelo de notificação de ausência.

O frontend nunca recebe token de máquina nem endereço privado do aplicativo.

## API usada pelo aplicativo desktop

### `GET /api/automation-worker/health`

Valida a identidade da instalação e informa a versão mínima suportada.

### `POST /api/automation-worker/heartbeat`

```json
{
  "worker_id": "computador-escola",
  "app_version": "2.0.0",
  "state": "online_available",
  "current_task_id": null
}
```

Atualiza disponibilidade, versão, tarefa atual e profundidade da fila.

### `POST /api/automation-worker/tasks/claim`

```json
{
  "worker_id": "computador-escola"
}
```

Reserva atomicamente a próxima tarefa FIFO da máquina autenticada e retorna
somente as entregas necessárias. Filas de máquinas diferentes são independentes.

### `POST /api/automation-worker/deliveries/:id/result`

```json
{
  "worker_id": "computador-escola",
  "status": "enviado",
  "erro_codigo": null,
  "external_id": "local-checkpoint-unico"
}
```

Aceita `enviado`, `erro` ou `ignorado`. Resultados finais são idempotentes. Uma
falha individual não encerra as demais entregas. Erros temporários respeitam o
limite configurado de tentativas.

## Persistência e concorrência

- `fila_automacao`: tarefa, usuário, máquina, idempotência, contadores e estado.
- `automacao_entregas`: snapshot mínimo por responsável ou grupo, mensagem,
  telefone mascarado, checkpoint, tentativas e falha pública.
- `automacao_maquinas`: heartbeat, versão, estado e tarefa atual.
- `automacao_eventos`: trilha técnica sem conteúdo de mensagem, telefone ou
  credencial.

As reservas usam transação, lock da máquina, `FOR UPDATE SKIP LOCKED`, lease e
ordenação por `data_solicitacao, id`. O heartbeat renova o lease da tarefa em
andamento. A fonte de verdade permanece no backend.

## Limpeza de fila e prevenção de duplicidade

A limpeza é lógica: tarefas pendentes passam para `cancelado` e deixam a fila
ativa, mas continuam disponíveis no histórico e na auditoria. O backend bloqueia
a linha da máquina antes da operação, portanto uma tarefa não pode ser capturada
pelo aplicativo desktop ao mesmo tempo em que está sendo removida. Tarefas já em
execução são sempre preservadas.

Notificações de ausência usam uma chave SHA-256 formada por tipo da notificação,
data da chamada, ID do aluno e ID do responsável; o telefone normalizado é usado
somente como alternativa quando não existe ID de responsável. A tabela
`automacao_deduplicacao` fornece exclusão mútua entre solicitações simultâneas.
Envio concluído, pendente ou em processamento bloqueia uma nova entrega. Falha
final ou cancelamento libera uma tentativa posterior. Telefones e conteúdo de
mensagem não são gravados nessa trava nem nos logs.

## Instalação

```powershell
cd backend
npm install
npm run migrate:automation-api
npm start
```

Variáveis:

```env
AUTOMATION_MACHINE_TOKENS={"1":"token-exclusivo-maquina-1-troque-aqui","2":"token-exclusivo-maquina-2-troque-aqui","3":"token-exclusivo-maquina-3-troque-aqui","4":"token-exclusivo-maquina-4-troque-aqui","5":"token-exclusivo-maquina-5-troque-aqui"}
AUTOMATION_DELIVERY_MAX_ATTEMPTS=3
AUTOMATION_DELIVERY_LEASE_SECONDS=300
AUTOMATION_DELIVERY_BATCH_SIZE=25
AUTOMATION_HEARTBEAT_TIMEOUT_SECONDS=60
AUTOMATION_TASK_RETENTION_DAYS=365
AUTOMATION_DEFAULT_COUNTRY_CODE=55
```
