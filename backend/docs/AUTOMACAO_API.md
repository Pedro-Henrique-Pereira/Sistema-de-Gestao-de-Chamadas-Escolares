# API da Automação Desktop

## Objetivo

Integrar o aplicativo `lysimaco-automacao-app` ao Sistema de Chamadas sem compartilhar banco, cookies, sessões pessoais ou módulos internos.

## Autenticação

A API usa token Bearer configurado em `AUTOMATION_SERVICE_TOKENS`. O middleware compara tokens em tempo constante e valida o número enviado em `X-Automation-Machine`.

Um token diferente em cada chave restringe cada instalação a uma máquina. Quando o mesmo token é repetido em várias chaves, o aplicativo pode alternar pela interface apenas entre essas máquinas autorizadas. O número selecionado nunca amplia as permissões do token.

Todas as requisições do aplicativo atualizado enviam:

```http
Authorization: Bearer <token>
X-Automation-Machine: 2
```

Essa rota é servidor-a-servidor e não usa cookies. Por isso, `/api/automation-worker` é montada antes do middleware CSRF, enquanto todas as rotas de navegador continuam protegidas normalmente. CORS e os headers de segurança globais permanecem ativos.

## Endpoints

### `GET /api/automation-worker/health`

Valida o token e informa a máquina associada.

### `POST /api/automation-worker/tasks/claim`

Corpo:

```json
{
  "worker_id": "maquina-1-escola"
}
```

Reserva transacionalmente uma tarefa e até o limite configurado de entregas. A resposta contém somente o necessário ao envio: ID técnico, canal, mensagem renderizada e telefone ou grupo de destino.

### `POST /api/automation-worker/deliveries/:id/result`

Corpo:

```json
{
  "worker_id": "maquina-1-escola",
  "status": "enviado",
  "erro_codigo": "FALHA_ENVIO"
}
```

Aceita `enviado`, `erro` ou `ignorado`. O endpoint é idempotente para resultados finais.

## Elegibilidade

O fluxo de faltas consulta apenas `registros_frequencia_alunos`, que representa chamadas confirmadas. A entrega exige:

- data correspondente à tarefa;
- status atual `ausente`;
- aluno não marcado como atrasado;
- aluno ativo;
- primeiro responsável ativo com contato válido.

A condição é revalidada antes da reserva. Uma edição que remova a falta transforma a entrega em `ignorado`.

## Idempotência e concorrência

`automacao_entregas.chave_idempotencia` é única:

- faltas: `falta:<data>:<aluno_id>`;
- grupos: `grupo:<tarefa_id>:<grupo_id>`.

Reservas usam transação, `FOR UPDATE SKIP LOCKED`, `lock_owner` e lease. Duas instâncias não recebem a mesma entrega simultaneamente. Falhas podem ser retomadas apenas enquanto `tentativas` estiver abaixo de `AUTOMATION_DELIVERY_MAX_ATTEMPTS`.

## Privacidade

A tabela não armazena telefone, texto da mensagem, token ou cookie. Ela mantém apenas referências, status, contador de tentativas, código resumido do erro e timestamps.

## Instalação

```powershell
cd backend
npm run migrate:automation-api
```

Variáveis:

```env
AUTOMATION_SERVICE_TOKENS={"1":"token-compartilhado-com-32-caracteres","2":"token-compartilhado-com-32-caracteres"}
AUTOMATION_DELIVERY_MAX_ATTEMPTS=3
AUTOMATION_DELIVERY_LEASE_SECONDS=300
AUTOMATION_DELIVERY_BATCH_SIZE=25
AUTOMATION_DEFAULT_COUNTRY_CODE=55
```
