# Relatório de teste de fluxo real — Sistema de Chamadas

Data: 22/07/2026
Janela principal: 00:18–00:38 (America/Sao_Paulo)
Execução: `QA20260722032443`

## 1. Resumo

| Situação | Quantidade |
|---|---:|
| Cenários principais | 12 |
| Aprovados | 7 |
| Reprovados | 2 |
| Parcialmente aprovados | 2 |
| Não executados | 1 |

Validações automatizadas complementares:

- Backend: **99/99 aprovadas**.
- Frontend: **29/29 aprovadas**.
- Aplicação Python da automação: **17/17 aprovadas**.
- Total automatizado complementar: **145/145 aprovadas**.
- Build Vite: **aprovado**, 1.809 módulos, 5,06 s, bundle JS de 364,23 kB (106,75 kB gzip).

Veredito: **não aprovado para produção sem correção dos dois bugs de alta gravidade**. O uso assistido em desenvolvimento/homologação é possível.

## 2. Ambiente

- Backend: Node.js/Express local em `127.0.0.1:3001`.
- Frontend: Vite local em `192.168.0.22:5173`.
- Banco: MySQL local, schema `Sistema_Chamada`, `DB_HOST=localhost`.
- Ambiente confirmado: `NODE_ENV=development`.
- Sistema operacional: Windows.
- Perfis: 1 administrador, 2 professores e 2 pedagogas.
- Automação: Máquina 1, versão 2.0.0, estado inicial e final `online_available`.
- Navegador da automação: Google Chrome/ChromeDriver 150.0.7871.124 via Selenium.
- Controle visual do frontend: não executado; a conexão do navegador interno do Codex falhou por erro de ACL do próprio ambiente antes de abrir a aplicação.
- Configuração escolar observada e preservada: horário limite `17:07:00`; bloqueio de edição após horário desativado.
- Nenhuma configuração, migration, API, código-fonte ou schema foi alterado.
- Nenhum commit foi criado.
- Processos do backend, frontend e Máquina 1 já estavam ativos e não foram encerrados.

### Confirmação de segurança dos envios

Antes do lote, todos os destinatários elegíveis do dia foram auditados no banco.

- Destinatários elegíveis: 7.
- Destinatários fora do telefone autorizado: 0.
- Número utilizado: exclusivamente `44 99139-5827` (normalizado como `5544991395827`).
- Entregas efetivamente enviadas: 7.
- Duplicidades bloqueadas: 2.
- Falhas de envio: 0.
- Fila final da Máquina 1: 0.

## 3. Massa de teste

Massa principal:

- 5 usuários: `ADMIN`, `PROF1`, `PROF2`, `PED1`, `PED2`.
- 3 turmas: `QA20260722032443A`, `QA20260722032443B`, `QA20260722032443C`.
- 15 alunos, 5 por turma.
- 15 responsáveis fictícios.
- Chamadas diárias: IDs 35, 36 e 37.
- Registros confirmados: IDs 29, 30 e 31.

Massa suplementar usada para repetir os testes de atraso com o campo obrigatório `versao`:

- 2 turmas: `QA20260722032443SUPD` e `QA20260722032443SUPE`.
- 10 alunos, 5 por turma.
- Chamadas IDs 38 e 39.
- Registros confirmados IDs 32 e 34.
- Nenhuma ausência elegível e nenhuma notificação criada para essas duas turmas.

Todos os alunos e responsáveis criados usam dados fictícios e o telefone autorizado.

## 4. Resultado por teste

### Teste 1 — Criação e associação dos dados

Passos:

1. Criar cinco contas com os três perfis institucionais.
2. Criar três turmas principais.
3. Criar cinco alunos por turma e um responsável por aluno.
4. Conferir por SQL a turma e o contato de cada aluno.
5. Criar duas turmas suplementares com cinco alunos cada para reexecução de atraso.

Esperado: registros íntegros, perfis corretos e somente o telefone autorizado.

Encontrado: 5 usuários, 5 turmas, 25 alunos e 25 responsáveis fictícios; todas as turmas têm 5 alunos e todos os contatos normalizam para `44991395827`.

Status: **aprovado**.

Evidências: respostas `201`, consultas em `usuarios`, `turmas`, `alunos` e `responsaveis`.

Observação: o modelo atual não possui associação explícita professor–turma; professores visualizam todas as turmas disponíveis. Isso é uma limitação de domínio existente, não uma falha criada pelo teste.

### Teste 2 — Cinco sessões simultâneas por API

Passos:

1. Autenticar simultaneamente administrador, dois professores e duas pedagogas.
2. Consultar `/api/auth/me` em cada sessão.
3. Exercitar a matriz RBAC.
4. Fazer logout/login novamente com o Professor 2 e recarregar o histórico.

Esperado: identidades isoladas, RBAC correto e persistência após novo login.

Encontrado: logins `200/200/200/200/200`, cinco IDs distintos; acessos proibidos retornaram `403`; logout retornou `200`, sessão antiga `401` e novo login `200`.

Status: **aprovado**.

### Teste 3 — Sessões visuais em navegadores/perfis separados

Passos: tentativa de conexão ao navegador interno para abrir o frontend local.

Esperado: cinco janelas/perfis visuais independentes.

Encontrado: o runtime do navegador do Codex encerrou antes de abrir a página por `windows sandbox failed: helper_unknown_error: apply deny-read ACLs`.

Status: **não executado**.

Impacto: nenhuma conclusão visual foi inferida; autenticação e isolamento foram validados diretamente na API.

### Teste 4 — Chamadas simultâneas em turmas diferentes

Passos:

1. Professor 1 registrar a turma A.
2. Professor 2 registrar a turma B em paralelo.
3. Criar a turma C enquanto dashboards eram consultados.
4. Conferir IDs, professores, turmas e totais no banco.

Esperado: chamadas independentes, sem mistura ou duplicidade.

Encontrado: chamadas 35, 36 e 37 vinculadas corretamente; nenhuma duplicidade por turma/data e nenhuma sobrescrita.

Status: **aprovado**.

### Teste 5 — Edição pelo professor

Passos:

1. Alterar presente para ausente e ausente para presente na chamada própria.
2. Tentar editar a mesma chamada com o outro professor.
3. Confirmar a chamada pela pedagogia.
4. Tentar editar novamente com o professor proprietário.
5. Enviar versão antiga para validar concorrência otimista.

Esperado: própria edição `200`, edição alheia bloqueada e chamada confirmada imutável para professor.

Encontrado: própria `200`, alheia `403`, confirmada `403`; payload desatualizado retornou `409` com orientação para atualizar a página.

Status: **aprovado**.

### Teste 6 — Revisão e confirmação por duas pedagogas

Passos:

1. Pedagoga 1 revisar/confirmar uma turma.
2. Pedagoga 2 revisar/confirmar outra turma ao mesmo tempo.
3. Repetir a concorrência nas turmas suplementares.
4. Reexecutar sequencialmente a confirmação que falhou.

Esperado: as duas confirmações retornarem `201` sem interferência.

Encontrado:

- Primeira concorrência: `201/201`.
- Segunda concorrência: `201/500`.
- Diagnóstico MySQL: deadlock entre duas inserções distintas no índice `uk_reg_chamada_origem`; o InnoDB desfez a transação 32172.
- Retry sequencial da chamada 39: `201`, registro confirmado 34.

Status: **reprovado**.

### Teste 7 — Atraso antes da confirmação

Passos:

1. Criar duas chamadas com um aluno ausente em cada.
2. Professor marcar atraso na turma D com a versão atual.
3. Pedagoga marcar atraso na turma E com a versão atual.
4. Confirmar as chamadas e consultar as frequências.

Esperado: ausência convertida para presença atrasada, horário e minutos persistidos.

Encontrado: ambos retornaram `200`; totais finais 5 presentes, 0 ausentes e 1 atraso; horários `00:35:52`; cálculo de 0 minuto, coerente por chamada e marcação no mesmo minuto.

Status: **aprovado**.

### Teste 8 — Regras depois do limite e bloqueio ativo/desativado

Passos:

1. Ler a configuração real sem alterá-la.
2. Executar testes unitários dos fluxos com bloqueio ativo e desativado.
3. Validar em ambiente real o estado disponível no horário da execução.

Esperado: bloqueio ativo impedir edição após o limite; bloqueio desativado permitir somente à pedagoga, preservando o cálculo.

Encontrado: os testes unitários passaram nos dois modos. No ambiente real, o bloqueio estava desativado e a execução ocorreu às 00h, antes do limite de 17:07; portanto, o ramo real pós-limite não pôde ser exercitado sem alterar configuração ou aguardar o horário.

Status: **parcialmente aprovado**.

### Teste 9 — Guarda de horário da automação

Passos:

1. Confirmar chamadas antes do horário limite.
2. Criar tarefa de ausência diretamente pelo endpoint autenticado.
3. Comparar `data_solicitacao` com o limite escolar.

Esperado: automação indisponível até o horário máximo de chegada, conforme `canStartAutomation`.

Encontrado: tarefa 84 criada às `00:31:10` e processada antes do limite `17:07:00`; o endpoint retornou sucesso e a Máquina 1 enviou as mensagens.

Status: **reprovado**.

### Teste 10 — Envio individual pela Máquina 1

Passos:

1. Auditar todos os contatos elegíveis.
2. Criar a tarefa 84 para a chamada confirmada 29.
3. Acompanhar `queued → processing → completed_successfully`.
4. Conferir logs e resultados individuais.

Esperado: tarefa na Máquina 1, progresso visível e resultados por aluno.

Encontrado: 2/2 envios concluídos, 0 falhas; início `00:31:25`, conclusão `00:32:11`; logs confirmam conversa aberta, mensagem enviada e checkpoint aceito pela API.

Status: **aprovado**.

### Teste 11 — Lote e bloqueio de mensagens repetidas

Passos:

1. Repetir a turma A com a Pedagoga 2.
2. Solicitar preview das três turmas.
3. Criar lote na Máquina 1.
4. Acompanhar tarefas 86 e 87.
5. Conferir deduplicação no banco.

Esperado: turma A ignorada; somente B e C entram na fila; sucessos, duplicidades e falhas separados.

Encontrado:

- Reenvio individual: 2 itens `DUPLICATE_ALREADY_SENT`, 0 novos envios.
- Preview: 3 turmas, 7 ausências, 7 contatos válidos, 0 inválidos.
- Lote: 2 tarefas adicionadas; 2 destinatários já notificados; 0 erros.
- Tarefa 86: 3/3 sucessos.
- Tarefa 87: 2/2 sucessos.
- Fila final: vazia; Máquina 1 novamente disponível.

Status: **aprovado**.

### Teste 12 — Concorrência e consistência geral

Passos:

1. Criar chamadas simultâneas.
2. Consultar dashboards durante criação/confirmação.
3. Confirmar chamadas em paralelo.
4. Acompanhar tarefas FIFO.
5. Recarregar estado após logout/login.
6. Conferir agregados, duplicidades e filas no banco.

Esperado: nenhuma perda, mistura, duplicidade, deadlock ou erro 500.

Encontrado: criação, dashboards, sessão, filas e persistência permaneceram consistentes; porém uma das confirmações paralelas sofreu deadlock e retornou 500. O retry sequencial recuperou o fluxo.

Status: **parcialmente aprovado**.

## 5. Bugs encontrados

### BUG-01 — Confirmações simultâneas podem gerar deadlock e HTTP 500

- Gravidade: **alta**.
- Perfis afetados: pedagoga e administração.
- Fluxo: confirmação de chamadas.
- Passos para reproduzir:
  1. Manter duas chamadas pendentes distintas.
  2. Autenticar duas pedagogas.
  3. Enviar simultaneamente `POST /api/pedagoga/chamadas/38/confirmar` e `POST /api/pedagoga/chamadas/39/confirmar`, com listas e versões atuais.
- Esperado: `201/201`, ou retry transacional transparente.
- Atual: `201/500`.
- Mensagem pública: `Ocorreu um erro interno no servidor`.
- Evidência MySQL: deadlock às `00:35:52` no índice `uk_reg_chamada_origem` de `registros_chamadas_confirmadas`; transação 32172 revertida.
- Recuperação observada: retry sequencial retornou `201`.
- Impacto: uma pedagoga pode receber erro e acreditar que a chamada não foi processada; exige ação manual e pode interromper operação simultânea real.

### BUG-02 — Endpoint permite iniciar notificações antes do horário limite

- Gravidade: **alta**.
- Perfis afetados: pedagoga e administração.
- Fluxo: notificações de ausência.
- Passos para reproduzir:
  1. Confirmar chamada antes de `horario_limite_atraso`.
  2. Enviar `POST /api/automation/tasks/attendance-notifications` com chamada confirmada e Máquina 1.
  3. Acompanhar a tarefa.
- Esperado: bloqueio com erro controlado até o limite, conforme `canStartAutomation`.
- Atual: tarefa criada às `00:31:10`, antes do limite `17:07:00`, e 2 mensagens foram enviadas.
- Mensagem de erro: nenhuma; requisição aceita.
- Impacto: responsáveis podem receber aviso de falta antes de terminar a janela de chegada/atraso.

## 6. Evidências da automação

| Tarefa | Origem | Resultado |
|---:|---|---|
| 84 | Turma A individual | 2 sucessos, 0 falhas |
| 85 | Reenvio da turma A por outra pedagoga | 2 duplicidades ignoradas, 0 envios |
| 86 | Lote — turma B | 3 sucessos, 0 falhas |
| 87 | Lote — turma C | 2 sucessos, 0 falhas |

Logs locais relevantes:

- `lysimaco-automacao-app/logs/app.log`
- `lysimaco-automacao-app/logs/envios.log`

Os logs registram captura FIFO, inicialização do Chrome, WhatsApp pronto, envio, confirmação da API e finalização sem falhas. Telefones aparecem mascarados como `55*******27`.

## 7. Conclusão

Fluxos funcionando:

- autenticação e isolamento de sessões por conta;
- RBAC;
- criação de usuários, turmas, alunos e responsáveis;
- chamadas simultâneas em turmas diferentes;
- edição do professor com propriedade e controle de versão;
- bloqueio de professor após confirmação;
- justificativas e edição pedagógica;
- cálculo e persistência de atraso;
- Máquina 1, fila FIFO, progresso e retorno ao estado disponível;
- envio individual e em lote;
- deduplicação persistente entre pedagogas;
- logout/login e recarga lógica;
- testes automatizados e build.

Riscos antes da produção:

1. Tratar deadlock de confirmação com ordem de locks/retry transacional e resposta controlada.
2. Aplicar a regra `canStartAutomation` também no backend dos endpoints individual, preview e lote; a interface não pode ser a única autoridade.
3. Reexecutar a concorrência de confirmação após a correção.
4. Reexecutar visualmente as cinco sessões quando o controle de navegador estiver disponível.
5. Validar ao vivo os ramos pós-limite com bloqueio ativo e desativado em uma janela controlada.

Automação da Máquina 1: **funcionou corretamente no processamento e envio**.
Bloqueio de mensagens repetidas: **funcionou corretamente**.
Pronto para uso real: **não**, devido aos dois bugs de alta gravidade.
