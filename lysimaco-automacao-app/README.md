# Lysímaco Automação App

Aplicativo desktop independente que consulta a fila do Sistema de Chamadas e
opera o WhatsApp Web por Selenium.

## Separação das aplicações

```text
Sistema web -> backend/API -> fila persistente
                                ^
                                |
Aplicativo desktop -> heartbeat, claim e resultados -> WhatsApp Web
```

O aplicativo não acessa MySQL, não importa código do backend e não utiliza
login de pedagoga, administrador ou professor. O navegador do usuário não
precisa permanecer aberto depois que o backend aceita uma tarefa.

## Configuração

Copie `.env.example` para `.env` e defina:

```env
API_BASE_URL=https://api.seu-dominio.com
AUTOMATION_MACHINE_TOKENS={"1":"token-exclusivo-maquina-1-troque-aqui","2":"token-exclusivo-maquina-2-troque-aqui","3":"token-exclusivo-maquina-3-troque-aqui","4":"token-exclusivo-maquina-4-troque-aqui","5":"token-exclusivo-maquina-5-troque-aqui"}
AUTOMATION_APP_VERSION=2.0.0
AUTOMATION_WORKER_ID=computador-escola
NUMERO_MAQUINA=1
```

Os dois arquivos `.env` devem conter os cinco pares exatamente iguais. Cada
máquina possui seu próprio token: Máquinas 1 e 2 são das pedagogas; Máquinas 3,
4 e 5 são dos administradores. Os tokens continuam distintos e o aplicativo
sempre utiliza somente a credencial correspondente à máquina selecionada.

URLs remotas devem usar HTTPS. HTTP é aceito automaticamente apenas em
`localhost`; em rede local controlada, a liberação precisa ser explícita com
`ALLOW_INSECURE_HTTP=true`.

## Execução

Backend, em seu servidor:

```powershell
cd backend
npm install
npm run migrate:automation-api
npm start
```

Aplicativo, na máquina de automação:

```powershell
cd lysimaco-automacao-app
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py
```

Python 3.11 ou 3.12 é recomendado. O número inicial vem de `NUMERO_MAQUINA` e
pode ser alterado e salvo no painel antes de ligar a automação.

## Funcionamento

1. autentica a identidade da máquina;
2. envia heartbeat e versão;
3. captura somente a próxima tarefa FIFO da máquina;
4. processa cada responsável ou grupo separadamente;
5. grava um checkpoint técnico local antes de confirmar o resultado;
6. envia progresso e resultado ao backend;
7. continua a fila sem depender do navegador do usuário.

O arquivo `runtime/delivery-receipts.json` guarda apenas IDs técnicos e o
identificador local do checkpoint. Não armazena mensagem, telefone ou token.
Isso evita repetir automaticamente um envio já feito quando a confirmação da
API falha.

## Logs e testes

Os logs rotativos em `logs/` não registram mensagem, token nem telefone
completo.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Use `DRY_RUN=true` somente em validação controlada; nesse modo nenhuma mensagem
real é enviada.
