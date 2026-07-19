# Relatório de adaptação da automação

## 1. Funcionamento anterior

O aplicativo conectava diretamente ao mesmo MySQL do sistema web. Durante a inicialização, criava ou alterava `fila_automacao`, `grupos_whatsapp`, `config_mensagem_whatsapp` e `controle_envios_diarios`. O polling reservava uma linha com `SELECT ... FOR UPDATE SKIP LOCKED`, consultava faltas em `registros_frequencia_alunos`, buscava responsáveis e atualizava os estados diretamente.

O envio era feito pelo WhatsApp Web via Selenium. A prevenção de duplicidade usava a chave `(aluno_id, data_envio)` em `controle_envios_diarios`.

## 2. Incompatibilidades encontradas

- credenciais de banco necessárias no aplicativo;
- acesso sem autenticação e autorização da API;
- criação e alteração de schema durante a execução;
- acoplamento ao schema privado do backend;
- configuração de banco duplicada;
- estados de entrega limitados a `pendente`, `enviado` e `erro`;
- retentativas locais sem coordenação persistente;
- ausência de checkpoint entre o envio real e a confirmação remota;
- logs com telefone, responsável, aluno, grupo e mensagem completos;
- documentação e scripts de instalação divergentes;
- instalador Linux com permissões globais `777`;
- `run_windows.bat` apontando para um ambiente virtual diferente da documentação.

## 3. Bugs e riscos identificados

- uma linha `erro` em `controle_envios_diarios` bloqueava novas tentativas para todo o dia;
- a deduplicação por aluno/dia não distinguia estado da entrega nem proprietário do lock;
- o aplicativo poderia alterar o banco mesmo sem migração aprovada;
- uma reinicialização após enviar e antes de atualizar o banco poderia duplicar a mensagem;
- logs e exceções do Selenium podiam expor telefone e conteúdo na URL;
- grupo removido ou falta editada depois da criação da tarefa não eram revalidados por uma autoridade central;
- duas versões diferentes do aplicativo poderiam disputar o schema;
- indisponibilidade ou mudança no MySQL derrubava diretamente o robô.

## 4. Solução implementada

Foi criada a API dedicada `/api/automation-worker`, autenticada por token Bearer exclusivo por máquina. O backend passou a ser a autoridade para:

- selecionar apenas faltas confirmadas;
- revalidar edições antes do envio;
- preparar entregas;
- reservar lotes com lock e lease;
- limitar retentativas;
- concluir ou falhar a tarefa;
- persistir checkpoints e idempotência.

O aplicativo agora recebe somente os dados necessários para operar o WhatsApp e reporta resultados por entrega. Todo código de acesso direto ao MySQL e os scripts SQL locais foram removidos.

## 5. Endpoints

- `GET /api/automation-worker/health`
- `POST /api/automation-worker/tasks/claim`
- `POST /api/automation-worker/deliveries/:id/result`

As rotas web existentes de professores, pedagogas e administradores não foram alteradas.

## 6. Autenticação

O backend recebe um mapa `AUTOMATION_SERVICE_TOKENS` no qual cada token autoriza uma ou mais máquinas. A comparação usa `crypto.timingSafeEqual`; a máquina escolhida na interface é enviada em `X-Automation-Machine` e precisa pertencer ao conjunto autorizado.

O aplicativo usa `API_BASE_URL`, `AUTOMATION_API_TOKEN`, `AUTOMATION_WORKER_ID` e `NUMERO_MAQUINA`. Ele recusa token menor que 32 caracteres, URL remota sem HTTPS e seleção de máquina não autorizada pelo token.

Não são usados cookies, JWT pessoal, sessão de usuário ou bypass de autenticação.

## 7. Prevenção de duplicidade

`automacao_entregas.chave_idempotencia` possui índice único:

- faltas: um envio por aluno e data;
- grupos: um envio por tarefa e grupo.

O backend usa transação, `FOR UPDATE SKIP LOCKED`, proprietário do lock e lease. O aplicativo grava um journal local contendo somente o ID técnico e o status imediatamente depois do envio. Na reinicialização, checkpoints pendentes são confirmados antes de novas capturas.

## 8. Falhas e retentativas

Cada entrega possui contador persistente. O padrão é 3 tentativas e o limite máximo aceito é 5. Falhas aguardam o polling antes da próxima tentativa. Estados em processamento com lease expirado podem ser recuperados.

Erros 429 e 5xx ou indisponibilidade de rede são tratados como temporários. Erros 401, 403 e 404 não entram em retentativa cega. O robô não captura novas tarefas enquanto existir um envio já concluído localmente aguardando confirmação da API.

## 9. Segurança e privacidade

- telefone mascarado nos logs;
- grupo identificado por hash técnico;
- ausência de token, cookie, mensagem ou telefone nas tabelas de checkpoint;
- erros persistidos somente como código resumido;
- token armazenado somente em `.env`;
- rota técnica limitada por rate limit;
- CSRF preservado em todas as rotas de navegador;
- instalação Linux por usuário, sem `777` e sem auto-start implícito.

## 10. Testes executados

- suíte backend: regras de chamada, permissões, CSRF, segurança, fila, auditoria e API do worker;
- testes Python: contrato da API, 401, 403, 404, 429, 500, mascaramento e journal após reinicialização;
- build Vite de produção;
- compilação de todos os módulos Python;
- `node --check` nos módulos críticos;
- varredura confirmando ausência de MySQL no aplicativo.

## 11. Riscos e limitações restantes

O WhatsApp Web não oferece confirmação transacional oficial. O journal local reduz a janela de duplicidade, mas a perda simultânea do disco do aplicativo e da confirmação no backend ainda exige conferência manual.

A migração precisa ser aplicada no MySQL real antes do primeiro uso. O teste com envio real depende de uma sessão válida do WhatsApp Web e deve ser feito inicialmente com um número/grupo controlado.

## 12. Execução separada

Consulte `README.md` neste diretório e `backend/docs/AUTOMACAO_API.md`. O backend e o aplicativo podem ser iniciados, atualizados e executados em computadores distintos.
