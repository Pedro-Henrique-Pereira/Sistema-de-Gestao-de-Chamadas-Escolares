# Lysímaco Automação App

Aplicativo desktop independente que processa a fila de mensagens do Sistema de Chamadas e opera o WhatsApp Web por Selenium.

## Arquitetura

```text
Sistema web -> MySQL
      |
      v
API /api/automation-worker (Bearer por máquina)
      |
      v
Lysímaco Automação App -> WhatsApp Web
```

O aplicativo não acessa o MySQL, não importa módulos do backend e não utiliza login pessoal de administrador, pedagoga ou professor. Toda integração ocorre pela API autenticada.

## Fluxo de envio

1. Um usuário autorizado solicita a automação no sistema web.
2. O backend registra a tarefa em `fila_automacao`.
3. O aplicativo reivindica um lote em `POST /api/automation-worker/tasks/claim`.
4. O backend considera apenas faltas confirmadas em `registros_frequencia_alunos`.
5. Cada destinatário recebe uma chave idempotente e um estado persistente em `automacao_entregas`.
6. O aplicativo envia a mensagem pelo WhatsApp Web.
7. Um checkpoint técnico é gravado localmente antes da confirmação remota.
8. O resultado é confirmado em `POST /api/automation-worker/deliveries/:id/result`.

Chamadas temporárias não são consultadas. Antes da reserva, o backend revalida o estado mais recente da falta; uma falta editada para presença, atraso ou outro estado não elegível é ignorada.

## Estados

- `pendente`: ainda não reservada.
- `processando`: reservada por um worker durante uma janela limitada.
- `enviado`: envio confirmado.
- `erro`: tentativa falhou e pode ser retomada até o limite.
- `cancelado`: cancelada antes do processamento.
- `ignorado`: deixou de ser elegível ou não possui destino válido.

O backend controla o limite de tentativas. O padrão é 3 e a faixa aceita é de 1 a 5. Locks expirados voltam de forma controlada; não existe loop de retentativa sem limite.

## Configuração do backend

No `backend/config.env`, repita o mesmo token nas máquinas que poderão ser selecionadas por este aplicativo:

```env
AUTOMATION_SERVICE_TOKENS={"1":"token-aleatorio-com-ao-menos-32-caracteres","2":"token-aleatorio-com-ao-menos-32-caracteres","3":"outro-token-restrito-com-ao-menos-32-caracteres"}
AUTOMATION_DELIVERY_MAX_ATTEMPTS=3
AUTOMATION_DELIVERY_LEASE_SECONDS=300
AUTOMATION_DELIVERY_BATCH_SIZE=25
```

Gere tokens aleatórios e nunca os versione. Depois aplique a migração:

```powershell
cd backend
npm run migrate:automation-api
```

## Configuração do aplicativo

Copie `.env.example` para `.env` e preencha:

```env
API_BASE_URL=https://api.seu-dominio.com
AUTOMATION_API_TOKEN=token-das-maquinas-autorizadas
AUTOMATION_WORKER_ID=automacao-escola
NUMERO_MAQUINA=1
```

`NUMERO_MAQUINA` é apenas o valor inicial. Depois, o número pode ser alterado e salvo pela interface. O backend aceita a troca somente quando `AUTOMATION_API_TOKEN` estiver repetido na chave da máquina selecionada em `AUTOMATION_SERVICE_TOKENS`.

URLs remotas exigem HTTPS. HTTP pode ser usado por padrão apenas em `localhost`; para uma rede local controlada, a liberação precisa ser explícita com `ALLOW_INSECURE_HTTP=true`.

## Execução separada

Backend:

```powershell
cd backend
npm install
npm start
```

Aplicativo:

```powershell
cd lysimaco-automacao-app
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py
```

Os dois projetos podem rodar em computadores e ciclos de atualização diferentes. O aplicativo tolera indisponibilidade temporária da API usando timeout, polling limitado e checkpoints persistentes.

## Logs e privacidade

Os logs ficam em `logs/` com rotação. Eles registram tarefa, entrega, tentativa e resultado. Telefones são mascarados; nomes, mensagens, tokens, cookies e dados pessoais completos não são gravados.

O arquivo `runtime/delivery-receipts.json` guarda somente IDs técnicos de envios já executados que ainda aguardam confirmação da API. Ele impede que uma reinicialização repita um envio já concluído localmente.

## Testes

Backend:

```powershell
cd backend
npm test
```

Aplicativo:

```powershell
cd lysimaco-automacao-app
python -m unittest discover -s tests -v
```

Para validar sem enviar mensagens reais, use `DRY_RUN=true`. As entregas serão marcadas como ignoradas, sem registrar o conteúdo no log.

## Limitação operacional

O WhatsApp Web não fornece uma transação atômica entre o clique de envio e a confirmação na API. O journal local reduz essa janela: assim que o Selenium retorna sucesso, o ID técnico é persistido antes da chamada à API. A perda simultânea do disco local e da confirmação remota ainda exige conferência manual.
