# Árvore detalhada da estrutura atual do sistema

**Projeto:** Sistema de Gerenciamento de Chamadas Escolares
**Data do levantamento:** 22 de julho de 2026
**Diretório analisado:** `C:\Users\PHtw9\Desktop\Sistema-Chamadas`

---

## 1. Critério usado no levantamento

Esta árvore representa os arquivos de código, configuração, infraestrutura,
documentação e testes existentes atualmente no projeto.

Para manter o documento legível e evitar exposição de dados locais, não foram
expandidos:

- `.git/`;
- `node_modules/`;
- `.venv/` e `venv/`;
- `dist/`, `build/` e `coverage/`;
- `__pycache__/` e `.vite/`;
- logs gerados em execução;
- conteúdo de `runtime/` da automação;
- conteúdo de arquivos `.env`, `config.env`, `config.local.json` ou secrets.

Os nomes desses arquivos e diretórios são mostrados quando importantes para
entender a arquitetura, mas seus valores não são reproduzidos.

---

## 2. Visão geral

```text
Sistema-Chamadas/
├── backend/                  API Node.js/Express, regras e acesso ao MySQL
├── frontend/                 SPA React/Vite e configuração Nginx
├── lysimaco-automacao-app/   aplicativo desktop Python separado
├── deploy/                   deploy, rollback e Cloudflare Tunnel
├── docs/                     documentação atual de produção e estrutura
├── .github/                  automação GitHub Actions
├── .codex/                   utilitários locais de QA usados pelo Codex
├── .agents/                  configuração local de agentes
├── .secrets/                 skills locais; conteúdo sensível não exibido
├── scripts/                  diretório reservado atualmente sem arquivos
└── arquivos de raiz          Compose, ambientes de exemplo e documentação
```

---

## 3. Árvore completa dos arquivos atuais

```text
Sistema-Chamadas/
│
├── .agents/                                      # configuração local de agentes
│
├── .codex/                                       # scripts locais de inspeção e QA
│   ├── inspect-innodb-deadlock-2026-07-22.cjs
│   ├── inspect-qa-2026-07-22.cjs
│   ├── qa-audit-recheck.cjs
│   ├── qa-final-route-checks.cjs
│   ├── qa-fixture-details.cjs
│   ├── qa-integration-runner.cjs
│   ├── qa-real-flow-2026-07-22.cjs
│   ├── qa-real-flow-continuation-2026-07-22.cjs
│   ├── qa-retry-confirmation-2026-07-22.cjs
│   └── qa-supplemental-2026-07-22.cjs
│
├── .github/
│   └── workflows/
│       └── deploy-production.yml                 # testes e deploy da main por SSH
│
├── .secrets/
│   └── .skills/
│       └── web-security-hardening/
│           └── SKILL.md                          # skill local de auditoria web
│
├── backend/                                      # API, domínio e persistência
│   ├── docs/
│   │   ├── AUTOMACAO_API.md                      # contrato HTTP da automação
│   │   ├── LOGS_AUDITORIA.md                     # documentação da auditoria
│   │   └── MIGRACAO_AUTOMACAO_V2.md             # migração do contrato V2
│   │
│   ├── sql/                                      # scripts SQL consolidados/legados
│   │   ├── 01_migracao_fila_automacao_lock_maquina.sql
│   │   ├── railway_schema_lysimaco_digital_consolidado.sql
│   │   └── recriar_banco_atual.sql
│   │
│   ├── src/
│   │   ├── config/
│   │   │   └── runtimeConfig.js                  # CORS, origens e trust proxy
│   │   │
│   │   ├── controllers/                          # adaptação HTTP para os serviços
│   │   │   ├── adminController.js
│   │   │   ├── auditoriaController.js
│   │   │   ├── authController.js
│   │   │   ├── automationController.js
│   │   │   ├── automationWorkerController.js
│   │   │   ├── chamadasController.js
│   │   │   ├── configuracoesEscolaController.js
│   │   │   ├── healthController.js               # /api/health e /api/ready
│   │   │   ├── mensagensController.js
│   │   │   ├── passwordResetController.js
│   │   │   ├── pedagogaController.js
│   │   │   ├── registrosController.js
│   │   │   ├── relatoriosController.js
│   │   │   └── usuariosConfigController.js
│   │   │
│   │   ├── database/
│   │   │   ├── migrations/
│   │   │   │   ├── 2026-05-31_grupos_escolares_mensagens_admin.sql
│   │   │   │   ├── 2026-05-31_mensagens_grupos_maquina_limpeza.sql
│   │   │   │   ├── 2026-05-31_turmas_grupo_maquina_chamadas.sql
│   │   │   │   ├── 2026-06-01_cancelamento_fila_automacao.sql
│   │   │   │   ├── 2026-06-01_indices_relatorios_performance.sql
│   │   │   │   ├── 2026-06-02_admin_mensagens_maquinas_3_4_5.sql
│   │   │   │   ├── 2026-06-03_sessoes_ativas.sql
│   │   │   │   ├── 2026-06-20_otimizacao_banco_relatorios_limpeza.md
│   │   │   │   ├── 2026-07-16_novo_fluxo_chamadas.md
│   │   │   │   ├── 2026-07-16_novo_fluxo_chamadas.sql
│   │   │   │   ├── 2026-07-18_bloqueio_edicao_chamadas.sql
│   │   │   │   ├── 2026-07-18_recuperacao_senha.sql
│   │   │   │   ├── 2026-07-19_automacao_api.sql
│   │   │   │   ├── 2026-07-19_logs_auditoria.sql
│   │   │   │   ├── 2026-07-20_automacao_tarefas_v2.sql
│   │   │   │   ├── 2026-07-21_automacao_deduplicacao.sql
│   │   │   │   ├── aplicarAutomacaoApi.js
│   │   │   │   ├── aplicarBloqueioEdicaoChamadas.js
│   │   │   │   ├── aplicarLogsAuditoria.js
│   │   │   │   ├── aplicarNovoFluxoChamadas.js
│   │   │   │   ├── aplicarRecuperacaoSenha.js
│   │   │   │   ├── executarLimpezaAuditoria.js
│   │   │   │   └── verificarAutomacaoApi.js
│   │   │   ├── connection.js                     # alias/entrada da conexão
│   │   │   └── db.js                             # pool mysql2/promise
│   │   │
│   │   ├── middlewares/                          # segurança e pré-processamento
│   │   │   ├── auditoriaMiddleware.js
│   │   │   ├── authMiddleware.js
│   │   │   ├── automationWorkerAuth.js
│   │   │   ├── csrfMiddleware.js
│   │   │   └── securityHeaders.js
│   │   │
│   │   ├── models/                               # persistência e consultas SQL
│   │   │   ├── passwordResetModel.js
│   │   │   ├── registrosModel.js
│   │   │   └── usuarioModel.js
│   │   │
│   │   ├── routes/                               # composição das rotas Express
│   │   │   ├── admin.routes.js
│   │   │   ├── auth.routes.js
│   │   │   ├── automation.routes.js
│   │   │   ├── automation-worker.routes.js
│   │   │   ├── chamadas.routes.js
│   │   │   ├── configuracoes-escola.routes.js
│   │   │   ├── mensagens.routes.js
│   │   │   ├── pedagoga.routes.js
│   │   │   ├── registros.routes.js
│   │   │   ├── relatorios.routes.js
│   │   │   └── usuarios.routes.js
│   │   │
│   │   ├── services/                             # regras de negócio reutilizáveis
│   │   │   ├── atrasoService.js
│   │   │   ├── auditoriaService.js
│   │   │   ├── automationDomain.js
│   │   │   ├── automationTaskService.js
│   │   │   ├── automationWorkerService.js
│   │   │   ├── chamadaAuditoriaService.js
│   │   │   ├── chamadaFluxoService.js
│   │   │   ├── chamadaService.js
│   │   │   ├── dashboardService.js
│   │   │   ├── emailService.js
│   │   │   ├── frequenciaMetricasService.js
│   │   │   ├── limpezaAuditoriaService.js
│   │   │   ├── limpezaAutomacaoService.js
│   │   │   ├── limpezaDadosService.js
│   │   │   └── passwordResetService.js
│   │   │
│   │   ├── tests/                                # testes Node nativos e utilitários
│   │   │   ├── atrasoUtils.test.js
│   │   │   ├── auditoria.test.js
│   │   │   ├── automationWorker.test.js
│   │   │   ├── chamadaFluxo.test.js
│   │   │   ├── comandos                          # fixture/arquivo auxiliar atual
│   │   │   ├── configuracoesEscola.test.js
│   │   │   ├── dashboardService.test.js
│   │   │   ├── errorHandler.test.js
│   │   │   ├── frequenciaMetricas.test.js
│   │   │   ├── mostrar-banco.test.js
│   │   │   ├── passwordReset.integration.test.js
│   │   │   ├── passwordReset.test.js
│   │   │   ├── registrosModel.test.js
│   │   │   ├── resetDatabase.js
│   │   │   ├── securityHardening.test.js
│   │   │   ├── seedDadosTeste.js
│   │   │   ├── sqlInjection.test.js
│   │   │   ├── stress-multi-login.test.js
│   │   │   ├── test.js
│   │   │   └── usuarioValidation.test.js
│   │   │
│   │   ├── utils/                                # funções puras e utilitários comuns
│   │   │   ├── atrasoUtils.js
│   │   │   ├── auditoriaSanitizer.js
│   │   │   ├── authCookies.js
│   │   │   ├── brasiliaTime.js
│   │   │   ├── dateValidation.js
│   │   │   ├── devAccess.js
│   │   │   ├── errorHandler.js
│   │   │   ├── formatadores.js
│   │   │   ├── publicDtos.js
│   │   │   └── usuarioValidation.js
│   │   │
│   │   └── server.js                             # bootstrap da API Express
│   │
│   ├── .env.exemple                              # exemplo seguro de ambiente
│   ├── config.env                                # ambiente local; conteúdo ocultado
│   ├── Dockerfile                                # imagem de produção do backend
│   ├── package.json                              # scripts e dependências Node
│   └── package-lock.json                         # lockfile do backend
│
├── deploy/                                       # operação no Ubuntu Server
│   ├── cloudflare/
│   │   └── config.yml.example                    # exemplo de ingress do Tunnel
│   ├── deploy.sh                                 # atualização e rollback automático
│   ├── README.md                                 # manual curto de operação
│   └── rollback.sh                               # retorno para SHA anterior
│
├── docs/                                         # documentação atual do projeto
│   ├── ARVORE_ESTRUTURA_ATUAL_2026-07-22.md      # este documento
│   ├── HOSPEDAGEM_PRODUCAO.md                    # manual completo de hospedagem
│   ├── RELATORIO_ADAPTACAO_PRODUCAO_2026-07-22.md
│   └── RELATORIO_DETALHADO_ADAPTACAO_PRODUCAO_2026-07-22.md
│
├── frontend/                                     # SPA React/Vite
│   ├── public/                                   # assets públicos copiados pelo Vite
│   │   ├── favicon.svg
│   │   └── icons.svg
│   │
│   ├── src/
│   │   ├── components/                           # componentes reutilizáveis
│   │   │   ├── AlunosAtrasadosCard.jsx
│   │   │   ├── AuthState.jsx
│   │   │   ├── AutomacaoFeedbackModal.jsx
│   │   │   ├── GlobalFooter.jsx
│   │   │   ├── MetricProgressChart.jsx
│   │   │   ├── PrivateRoute.jsx
│   │   │   ├── RotaDesconhecida.jsx
│   │   │   └── TurmasDashboardCard.jsx
│   │   │
│   │   ├── context/
│   │   │   └── AuthContext.jsx                   # estado e validação da sessão
│   │   │
│   │   ├── pages/                                # telas e orquestração visual
│   │   │   ├── Admin.jsx
│   │   │   ├── EsqueciMinhaSenha.jsx
│   │   │   ├── Login.jsx
│   │   │   ├── LogsAuditoria.jsx
│   │   │   ├── MensagensAdmin.jsx
│   │   │   ├── Pedagoga.jsx
│   │   │   ├── Professor.jsx
│   │   │   ├── RedefinirSenha.jsx
│   │   │   └── RelatoriosAvancados.jsx
│   │   │
│   │   ├── services/                             # comunicação centralizada com a API
│   │   │   ├── api.js
│   │   │   ├── auditoriaService.js
│   │   │   ├── authService.js
│   │   │   ├── automacaoService.js
│   │   │   ├── chamadasService.js
│   │   │   ├── configuracoesEscolaService.js
│   │   │   ├── mensagensService.js
│   │   │   ├── pedagogaService.js
│   │   │   └── usuariosService.js
│   │   │
│   │   ├── styles/                               # estilos por tela/componente
│   │   │   ├── Admin.css
│   │   │   ├── AlunosAtrasadosCard.css
│   │   │   ├── AuthRecovery.css
│   │   │   ├── AuthState.css
│   │   │   ├── AutomacaoFeedbackModal.css
│   │   │   ├── GlobalFooter.css
│   │   │   ├── Login.css
│   │   │   ├── LogsAuditoria.css
│   │   │   ├── Pedagoga.css
│   │   │   ├── Professor.css
│   │   │   └── TurmasDashboardCard.css
│   │   │
│   │   ├── tests/                                # testes unitários/contratuais do frontend
│   │   │   ├── apiUrlSecurity.test.js
│   │   │   ├── atrasosSync.test.js
│   │   │   ├── authRouting.test.js
│   │   │   ├── automationIntegration.test.js
│   │   │   ├── frequenciaMetricas.test.js
│   │   │   ├── passwordValidation.test.js
│   │   │   └── privateDataCache.test.js
│   │   │
│   │   ├── utils/                                # regras puras usadas pela interface
│   │   │   ├── apiUrlSecurity.js
│   │   │   ├── atrasosSync.js
│   │   │   ├── authRouting.js
│   │   │   ├── authValidation.js
│   │   │   ├── brasiliaTime.js
│   │   │   ├── clientLogger.js
│   │   │   ├── frequenciaMetricas.js
│   │   │   ├── passwordValidation.js
│   │   │   └── privateDataCache.js
│   │   │
│   │   ├── App.jsx                               # rotas e composição principal
│   │   └── main.jsx                              # bootstrap React
│   │
│   ├── .env                                      # ambiente local; conteúdo ocultado
│   ├── .env.exemple                              # exemplo com VITE_API_URL=/api
│   ├── Dockerfile                                # build Vite e runtime Nginx
│   ├── eslint.config.js
│   ├── index.html
│   ├── nginx.conf                                # SPA, proxy /api e headers
│   ├── package.json
│   ├── package-lock.json
│   ├── README.md
│   ├── vercel.json                               # configuração da hospedagem legada
│   └── vite.config.js
│
├── lysimaco-automacao-app/                       # aplicativo desktop local independente
│   ├── app/
│   │   ├── __init__.py
│   │   └── ui.py                                 # interface gráfica do aplicativo
│   │
│   ├── assets/
│   │   ├── icon.png
│   │   └── logo.png
│   │
│   ├── automacao/
│   │   ├── config/
│   │   │   ├── __init__.py
│   │   │   └── settings.py                      # carregamento de configuração
│   │   ├── scripts/                              # diretório reservado, atualmente vazio
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── api_service.py                   # comunicação HTTPS com o backend
│   │   │   └── whatsapp_service.py              # execução local no WhatsApp Web
│   │   ├── sql/                                  # reservado; app não acessa MySQL direto
│   │   ├── support/
│   │   │   ├── __init__.py
│   │   │   └── error_ui.py                      # apresentação segura de erros
│   │   ├── __init__.py
│   │   └── main_automacao.py                    # orquestração principal do worker
│   │
│   ├── config/
│   │   ├── config.example.json                  # modelo seguro
│   │   └── config.local.json                    # configuração local; conteúdo ocultado
│   │
│   ├── core/                                     # diretório reservado atualmente vazio
│   ├── logs/
│   │   └── .gitkeep                             # preserva a pasta sem versionar logs
│   ├── runtime/                                  # dados gerados; conteúdo não expandido
│   ├── services/                                 # diretório reservado atualmente vazio
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── test_api_service.py
│   │   ├── test_whatsapp_service.py
│   │   └── test_whatsapp_startup.py
│   │
│   ├── .env                                      # ambiente local; conteúdo ocultado
│   ├── .env.example                              # modelo de ambiente
│   ├── como instalar.txt
│   ├── desinstalar.sh
│   ├── instalar.sh
│   ├── launcher.sh
│   ├── LysimacoAutomacao.desktop                 # atalho Linux
│   ├── main.py                                   # entrada do aplicativo
│   ├── README.md
│   ├── RELATORIO_ADAPTACAO.md
│   ├── requirements.txt
│   └── run_windows.bat                           # inicialização no Windows
│
├── scripts/                                      # reservado, atualmente vazio
│
├── .dockerignore                                 # exclui segredos, builds e automação
├── .env.production.example                       # referência segura para o servidor
├── .gitignore                                    # proteção de ambientes e artefatos locais
├── AGENTS.md                                     # regras obrigatórias de trabalho no projeto
├── banco_dados.md                                # schema e regras de banco
├── docker-compose.prod.yml                       # orquestração oficial de produção
├── HOSPEDAGEM_PRODUCAO_SISTEMA_CHAMADA.md        # planejamento original de hospedagem
├── README.md                                     # visão geral do sistema
├── RELATORIO_AUDITORIA_SEGURANCA_2026-07-18.md
├── RELATORIO_FLUXO_REAL_2026-07-22.md
└── RELATORIO_QA_INTEGRACAO_2026-07-16.md
```

---

## 4. Estrutura lógica do backend

O fluxo principal continua seguindo a arquitetura esperada:

```text
Requisição HTTP
  -> route
    -> middleware de autenticação, autorização, CSRF ou auditoria
      -> controller
        -> service
          -> model ou pool MySQL
            -> resposta pública sanitizada
```

### Responsabilidade por pasta

| Pasta | Responsabilidade |
| --- | --- |
| `src/config` | Configuração derivada de variáveis de ambiente |
| `src/controllers` | Receber requisições e produzir respostas HTTP |
| `src/database` | Pool, migrations e rotinas de manutenção do schema |
| `src/middlewares` | Autenticação, RBAC, CSRF, auditoria e headers |
| `src/models` | Persistência e consultas específicas |
| `src/routes` | Declaração dos endpoints e composição de middlewares |
| `src/services` | Regras de negócio e integrações reutilizáveis |
| `src/tests` | Testes e ferramentas locais de banco/fixtures |
| `src/utils` | Validação, datas, cookies, DTOs e tratamento de erros |

---

## 5. Estrutura lógica do frontend

```text
main.jsx
  -> App.jsx
    -> páginas
      -> componentes
        -> services
          -> api.js
            -> /api no Nginx
              -> backend
```

### Responsabilidade por pasta

| Pasta | Responsabilidade |
| --- | --- |
| `src/components` | Elementos visuais reutilizáveis |
| `src/context` | Sessão e autenticação compartilhadas |
| `src/pages` | Telas de cada perfil e fluxos públicos |
| `src/services` | Única camada autorizada a conversar com a API |
| `src/styles` | CSS das páginas e componentes |
| `src/tests` | Contratos de autenticação, métricas, cache e automação |
| `src/utils` | Funções puras de validação, roteamento e sincronização |

---

## 6. Estrutura lógica da automação desktop

```text
main.py
  -> app/ui.py
  -> automacao/main_automacao.py
    -> automacao/services/api_service.py
    -> automacao/services/whatsapp_service.py
```

O aplicativo desktop:

- é executado localmente na escola;
- usa Python;
- consome o backend pela API de worker;
- não é containerizado junto ao sistema web;
- não possui acesso direto ao MySQL;
- mantém configurações e runtime locais;
- permanece excluído do contexto Docker.

---

## 7. Estrutura de produção

```text
.github/workflows/deploy-production.yml
             |
             v
deploy/deploy.sh -----> deploy/rollback.sh
             |
             v
docker-compose.prod.yml
  ├── mysql
  ├── backend  <--- backend/Dockerfile
  ├── frontend <--- frontend/Dockerfile + frontend/nginx.conf
  └── cloudflared <--- deploy/cloudflare/config.yml.example
```

Arquivos de ambiente e credenciais reais ficam fora do repositório:

```text
/opt/lysimaco/env/backend.env
/opt/lysimaco/env/mysql.env
/opt/lysimaco/cloudflare/config.yml
/opt/lysimaco/cloudflare/<TUNNEL_ID>.json
```

---

## 8. Diretórios gerados ou não expandidos

Estes diretórios podem existir localmente, mas não representam código-fonte e
não foram detalhados arquivo por arquivo:

```text
.git/                                  metadados e objetos Git
backend/node_modules/                  dependências instaladas do backend
frontend/node_modules/                 dependências instaladas do frontend
frontend/dist/                         build estático gerado pelo Vite
lysimaco-automacao-app/.venv/          ambiente virtual Python
lysimaco-automacao-app/runtime/        estado local e navegador da automação
**/__pycache__/                        bytecode Python
**/.vite/                              cache Vite
**/coverage/                           cobertura de testes
**/*.log                               logs gerados
```

Esses diretórios não devem entrar nas imagens ou em commits.

---

## 9. Pontos de entrada do sistema

| Camada | Arquivo de entrada |
| --- | --- |
| Backend | `backend/src/server.js` |
| Frontend | `frontend/src/main.jsx` |
| Rotas React | `frontend/src/App.jsx` |
| Cliente HTTP | `frontend/src/services/api.js` |
| Banco | `backend/src/database/db.js` |
| Automação desktop | `lysimaco-automacao-app/main.py` |
| Orquestração Docker | `docker-compose.prod.yml` |
| Deploy | `deploy/deploy.sh` |
| Rollback | `deploy/rollback.sh` |
| CI/CD | `.github/workflows/deploy-production.yml` |

---

## 10. Fontes de verdade documentais

| Documento | Uso |
| --- | --- |
| `AGENTS.md` | regras obrigatórias para alterações no projeto |
| `README.md` | visão funcional e arquitetural geral |
| `banco_dados.md` | schema, relacionamentos, índices e regras de banco |
| `docs/HOSPEDAGEM_PRODUCAO.md` | operação do ambiente Ubuntu/Docker |
| `docs/RELATORIO_DETALHADO_ADAPTACAO_PRODUCAO_2026-07-22.md` | inventário da adaptação de produção |
| este documento | mapa atualizado de pastas e arquivos |

---

## 11. Observações importantes

- `backend/config.env`, `frontend/.env`, `lysimaco-automacao-app/.env` e
  `config.local.json` são locais e não tiveram seu conteúdo exposto.
- `.secrets/` é uma estrutura local e não faz parte da aplicação de produção.
- `.codex/` contém ferramentas auxiliares de QA, não módulos carregados pelo
  frontend ou backend.
- `frontend/vercel.json` e arquivos SQL com nomes Railway representam
  compatibilidade ou histórico da hospedagem anterior.
- `scripts/`, `lysimaco-automacao-app/core/`,
  `lysimaco-automacao-app/services/` e alguns diretórios internos da automação
  estão atualmente vazios ou reservados para evolução futura.
- A árvore deve ser atualizada quando novos módulos, migrations, páginas ou
  serviços de infraestrutura forem adicionados.
