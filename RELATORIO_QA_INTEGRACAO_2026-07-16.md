# Relatório de QA e Integração — Sistema de Chamadas

Data: 16/07/2026
Execuções principais: `QA20260716212416` e `QA20260716212615`
Escopo excluído: mensagens, WhatsApp, Python/RPA e consumo da fila de automação.

## 1. Resumo executivo

O sistema demonstrou boa estabilidade nos fluxos normais de autenticação, RBAC, cadastros, chamadas, confirmação pedagógica, frequência, dashboards, relatórios e concorrência controlada. Não ocorreram deadlocks, perda de inserções ou duplicidade de chamada ativa.

Entretanto, o sistema **não deve ser considerado pronto para produção** antes da correção do problema que permite editar uma chamada já confirmada. O teste deixou uma divergência real e intencionalmente preservada entre o registro temporário e o histórico permanente.

### Totais

| Categoria | Executados | Aprovados | Falhas |
|---|---:|---:|---:|
| API, integração, autenticação, banco e concorrência | 56 | 53 | 3 |
| Cenários reais de frontend | 11 | 8 | 3 |
| Build e sintaxe | 2 | 2 | 0 |
| **Total** | **69** | **63** | **6** |

Além das seis falhas contabilizadas, foi identificado um problema de semântica HTTP no CORS, totalizando **sete bugs documentados**.

Nível geral de estabilidade: **médio/bom para operação assistida; insuficiente para produção sem correções prioritárias**.

## 2. Metodologia

- API local Express em `127.0.0.1:3001` utilizando o banco configurado em `backend/config.env`.
- Frontend Vite validado em `192.168.0.22:5173` com interação real pelo navegador.
- Consultas diretas MySQL para persistência, schema, índices, FKs e inconsistências.
- Fixtures com prefixos únicos para não colidir com dados anteriores.
- Nenhuma automação de WhatsApp foi solicitada, consultada, cancelada ou executada.
- Nenhum dado existente ou criado foi removido.
- Exclusões foram testadas somente contra IDs inexistentes.
- A configuração de atraso foi temporariamente aberta para `23:59` e restaurada para `08:45` ao final.

## 3. Cobertura executada

### Autenticação e sessão

- Login válido nos três perfis.
- Senha inválida, usuário inexistente, campos vazios e payload de SQL injection.
- JWT expirado e JWT adulterado.
- Cookies `token` HttpOnly e `csrfToken`.
- Requisição mutável sem CSRF.
- Logout e invalidação no banco.
- Dois logins na mesma conta: a sessão anterior foi invalidada (`401`) e a nova permaneceu válida (`200`).
- Contas diferentes simultâneas: revalidação isolada `200/200`.

### Rate limit

- Cinco tentativas inválidas retornaram `401`.
- A sexta e a sétima retornaram `429`.
- `Retry-After`: 900 segundos.
- Sete logins válidos consecutivos retornaram `200`.
- O bloqueio de uma conta não afetou outra conta.

### RBAC

- Administração acessou `/api/admin` e `/api/registros`.
- Professor e pedagoga receberam `403` nas rotas administrativas.
- Professor recebeu `403` nas rotas pedagógicas.
- Pedagoga e administração acessaram o painel pedagógico.
- Redirecionamentos de `/professor`, `/pedagoga` e `/admin` foram confirmados no frontend.

### Cadastros

- Criação de administradores, professores e pedagogas.
- Criação e edição de turmas.
- Criação, edição, busca e paginação de alunos.
- Troca de turma.
- Criação, busca e edição de responsáveis.
- Edição de integrante da equipe.
- Atualização da própria conta.
- Validação de configuração escolar válida e inválida.

### Frequência e chamadas

- Chamadas simultâneas em turmas diferentes.
- Corrida de duas chamadas para a mesma turma.
- Edição pelo professor proprietário e bloqueio para outro professor.
- Confirmação pedagógica transacional.
- Bloqueio de confirmação duplicada.
- Chamada pedagógica.
- Presente, ausente, justificado e atrasado.
- Remoção e restauração de atraso.
- Justificativa criada por edição de frequência.
- Persistência conferida pela API, frontend e SQL.

### Relatórios e dashboards

- Métricas gerais de 1 mês para administração e pedagoga.
- Resumo anual paginado.
- Resumo mensal.
- Histórico de justificativas.
- Filtros de turma e aluno.
- Exportação Excel por data e turma.
- Período ausente, período acima de três meses e aluno sem turma.
- Dashboards administrativo e pedagógico.
- Painel de atrasos.

### Concorrência

Executados simultaneamente:

- Professor A criando chamada.
- Professor B criando chamada.
- Pedagoga confirmando chamada.
- Administração consultando relatório.

Status observados: `201`, `201`, `201` e `200`.
Tempos: 7,11 ms a 20,77 ms.
Não foram observados deadlocks, timeouts, perda de dados ou duplicações.

## 4. Bugs encontrados

### BUG-01 — Chamada confirmada continua editável

Gravidade: **Alta**

Como reproduzir:

1. Professor registra chamada.
2. Pedagoga confirma a chamada.
3. Professor abre “Chamadas realizadas”.
4. A interface ainda exibe o botão “Editar”.
5. Enviar `PUT /api/chamadas/:id`.

Esperado: `409` ou `403`, preservando a imutabilidade após confirmação.

Obtido: `200`.

Evidência preservada:

- `chamadas_diarias.id = 7`: matéria `QA20260716212615 ALTERADA APOS CONFIRMACAO`, totais `1/3`.
- `registros_chamadas_confirmadas.id = 6`: matéria `QA20260716212615 MAT A EDITADA`, totais `2/2`.

Causa provável: `chamadasController.atualizar` valida o proprietário, mas não valida `status = 'pendente'`. O frontend oferece edição com base apenas em `pode_editar`.

### BUG-02 — Turma duplicada retorna HTTP 500

Gravidade: **Média**

Como reproduzir: cadastrar novamente `QA20260716212615A`.

Esperado: `409 Conflict`.

Obtido: `500` com a mensagem correta “Já existe um registro com esses dados.”

Causa provável: o middleware traduz `ER_DUP_ENTRY`, mas mantém o status padrão `500`.

### BUG-03 — Exclusão de aluno/equipe inexistente declara sucesso

Gravidade: **Média**

Como reproduzir:

- `DELETE /api/registros/alunos/2147483647`
- `DELETE /api/registros/equipe/2147483647`

Esperado: `404`.

Obtido: `200` para ambos.

Causa provável: os models executam `DELETE` sem conferir `affectedRows`.

Observação: turma inexistente retorna corretamente `404`.

### BUG-04 — Botões aninhados na tela da pedagoga

Gravidade: **Média**

Resultado: erro no console React `validateDOMNesting: <button> cannot appear as a descendant of <button>`.

Causa: o botão do accordion de chamada contém os botões “Salvar & Iniciar Automação” e “Revisar”.

Impacto: HTML inválido, acessibilidade prejudicada e risco de eventos inconsistentes.

### BUG-05 — Rótulo promete iniciar automação sem iniciar

Gravidade: **Média/UX**

Na chamada pendente, o botão é exibido como “Salvar & Iniciar Automação”. O backend de confirmação retorna explicitamente `automacao: null` e informa que a automação não foi iniciada automaticamente.

O botão não foi acionado durante este QA para respeitar a exclusão do WhatsApp/RPA.

### BUG-06 — Data bruta na tela de chamadas da pedagoga

Gravidade: **Baixa/UX**

Obtido: `2026-07-16T03:00:00.000Z`.

Esperado: data localizada, por exemplo `16/07/2026`.

### BUG-07 — Origem CORS inválida retorna 500

Gravidade: **Baixa**

A origem `https://evil.example` foi corretamente bloqueada, mas retornou `500`.

Esperado: `403` com resposta controlada.

Não houve exposição de stack ou detalhes sensíveis.

## 5. Funcionalidades ausentes ou parciais

- Não existe fluxo formal de reabertura de chamada.
- Não existe exclusão explícita de justificativa; a atualização de frequência apaga e recria o registro.
- Não existe histórico/auditoria das alterações de frequência.
- Relatórios não possuem filtro por professor.
- Relatórios não fornecem médias além dos percentuais calculados no frontend.
- Observação da chamada não possui fluxo específico de edição após confirmação.
- Dashboards atualizam em carregamentos e ações; não há atualização realmente em tempo real.
- Status `ativo` do aluno existe no banco, mas o fluxo de remoção utiliza hard delete.

## 6. Banco de dados

### Situação geral

As 14 tabelas atuais atendem ao fluxo funcional implementado. As FKs estão ativas e os agregados dos registros permanentes ficaram consistentes com as frequências. Não foram encontradas justificativas duplicadas por frequência no estado atual.

Foi encontrada uma inconsistência temporário/permanente causada pelo BUG-01.

### Risco crítico de exclusão

`registros_frequencia_alunos.aluno_id` e `justificativas_frequencia.aluno_id` usam `ON DELETE CASCADE`.

Como o endpoint de aluno executa hard delete, excluir um aluno pode apagar histórico de frequência e justificativas. Esse teste destrutivo não foi executado.

Recomendação: usar desativação lógica com `alunos.ativo`, bloquear hard delete quando houver histórico e preservar dados acadêmicos.

### Índices da migration ausentes no banco real

- `idx_rcc_data_id`
- `idx_rfa_data_status_atraso`
- `idx_rfa_data_aluno`
- `idx_rfa_data_turma`

Os quatro índices seguintes estão presentes:

- `idx_alunos_turma_nome`
- `idx_cd_data_status_horario`
- `idx_jf_freq_aluno`
- `idx_usuarios_tipo_ativo_nome`

O banco real aparenta ter recebido apenas parte da migration documentada.

### Índices redundantes

| Tabela | Índices equivalentes |
|---|---|
| `fila_automacao` | `idx_fila_mensagens_grupo`, `idx_fila_tipo_status_maquina` |
| `justificativas_frequencia` | `idx_jf_aluno_freq`, `idx_just_relatorios_aluno_data` |
| `registros_chamadas_confirmadas` | `idx_rcc_turma_data`, `idx_reg_chamada_turma_data` |
| `registros_chamadas_confirmadas` | `idx_reg_origem`, `uk_reg_chamada_origem` |
| `registros_frequencia_alunos` | `idx_freq_aluno_data`, `idx_rfa_aluno_data` |
| `registros_frequencia_alunos` | `idx_freq_turma_data`, `idx_rfa_turma_data` |
| `turmas` | `idx_turmas_nome`, `uk_turmas_nome` |
| `usuarios` | `idx_usuarios_email`, `uk_usuarios_email` |

Índices únicos já atendem buscas pelo prefixo completo correspondente; os índices simples equivalentes devem ser reavaliados com `EXPLAIN` antes da remoção.

### Colunas recomendadas

- `registros_frequencia_alunos`: `atualizado_em`, `atualizado_por_id` e versão/revisão.
- `justificativas_frequencia`: `atualizado_em`, `atualizada_por_id`, `status` ou `removida_em`.
- `configuracoes_escola`: `atualizado_por_id`.
- `alunos`: `matricula` única e `data_nascimento` no lugar de idade estática.
- Entidades removíveis: `deleted_at` ou uso consistente de `ativo`.

### Tabelas sugeridas

- `auditoria_eventos`: login, alteração de configuração, cadastros e exclusões.
- `historico_frequencia`: estado anterior, estado novo, usuário, data e motivo.
- `matriculas`: histórico aluno/turma/ano letivo.
- `pessoas_responsaveis` e `aluno_responsavel`: evitar duplicação do mesmo responsável para irmãos.
- `professor_turma_materia`: caso professores devam ser limitados às próprias turmas e disciplinas.

### Normalização

- Nomes duplicados em registros confirmados são aceitáveis como snapshot histórico.
- O JSON `chamadas_diarias.alunos` duplica o estado relacional e permitiu a divergência observada.
- Responsáveis são armazenados por aluno, duplicando pessoas quando há irmãos.
- Recomenda-se `UNIQUE(frequencia_aluno_id)` em justificativas se a regra continuar sendo uma justificativa ativa por frequência.

## 7. Performance

### Resultados observados

- CRUD e validações comuns: aproximadamente 1–16 ms.
- Relatórios agregados: aproximadamente 18–26 ms.
- Exportação Excel com quatro linhas: 117,7 ms, 6.945 bytes.
- Concorrência de quatro operações: 7,11–20,77 ms.
- Build Vite: 4,26 s.
- Bundle JS: 317,68 kB; 93,45 kB gzip.

### EXPLAIN

- Dashboard por data utilizou `idx_rfa_automacao_faltas_dia`, tipo `ref`, `Using index`.
- Chamadas pendentes utilizaram `idx_cd_data_status_horario`, tipo `ref`, `Backward index scan; Using index`.

### Riscos futuros

- Exportação Excel monta o workbook inteiro em memória.
- Confirmação insere frequências sequencialmente em loop.
- `Admin.jsx`, `Pedagoga.jsx` e `RelatoriosAvancados.jsx` concentram muito estado e renderização.
- A busca de 24 alunos abriu todas as turmas e tabelas correspondentes, produzindo DOM muito grande.
- O rate limit é mantido em memória e pode divergir entre múltiplas instâncias ou reinicializações.

## 8. Segurança

### Aprovado

- SQL injection de login rejeitada.
- JWT expirado/adulterado rejeitado.
- Cookie JWT HttpOnly.
- CSRF obrigatório nas mutações.
- RBAC aplicado no backend e frontend.
- Rate limit isolado por IP/e-mail.
- Sessão única por usuário funcionando.
- CORS bloqueando origem não autorizada.

### Pontos de atenção

- `X-Powered-By: Express` permanece exposto.
- Não foi identificado uso de Helmet/CSP no backend.
- Rate limit em memória não é distribuído.
- As 12 contas de QA permanecem ativas por ordem expressa deste teste e devem ser desativadas antes de uso produtivo.

## 9. Dados criados e preservados

Nenhum registro abaixo foi apagado.

### Execução preparatória `QA20260716212416`

- Usuários IDs 6–11:
  - `qa20260716212416.admin@qa.local`
  - `qa20260716212416.profa@qa.local`
  - `qa20260716212416.profb@qa.local`
  - `qa20260716212416.peda@qa.local`
  - `qa20260716212416.pedb@qa.local`
  - `qa20260716212416.rate@qa.local`
- Turmas IDs 8–13: `A`, `B`, `C`, `RACE`, `CONCA`, `CONCB`, todas prefixadas pelo ID da execução.
- 18 alunos IDs 39–56.
- 18 responsáveis correspondentes.
- Nenhuma chamada criada nesta execução preparatória.

### Execução principal `QA20260716212615`

- Usuários IDs 12–17:
  - `qa20260716212615.admin@qa.local`
  - `qa20260716212615.profa@qa.local`
  - `qa20260716212615.profb@qa.local`
  - `qa20260716212615.peda@qa.local`
  - `qa20260716212615.pedb@qa.local`
  - `qa20260716212615.rate@qa.local`
- Turmas IDs 15–20:
  - `QA20260716212615A`
  - `QA20260716212615B`
  - `QA20260716212615C`
  - `QA20260716212615RACE`
  - `QA20260716212615CONCA`
  - `QA20260716212615CONCB`
- 24 alunos IDs 57–80.
- 24 responsáveis IDs 57–80.
- Aluno 57 editado para `QA20260716212615 ALUNO 01 EDITADO`.
- Aluno 66 movido para `QA20260716212615B`.
- Chamadas IDs 7, 8, 9, 11, 12 e 13.
- Chamadas confirmadas IDs 6, 7 e 8.
- Frequências IDs 27–39: 13 registros.
- Justificativas:
  - ID 3, frequência 29, `QA20260716212615 justificativa inicial`.
  - ID 4, frequência 30, `QA20260716212615 justificativa criada por edição`.
- Um atraso permanente preservado na frequência 28.
- Três chamadas permanecem pendentes: IDs 11, 12 e 13.
- Oito consultas de relatório agregado, uma exportação Excel e um gráfico no frontend.

As senhas temporárias conhecidas usadas no QA não foram registradas neste relatório por segurança.

## 10. Limitações deliberadas

- Nenhum endpoint `/api/mensagens/*` foi testado.
- Nenhum endpoint `/api/automacao/*` foi testado.
- Nenhum endpoint `/api/pedagoga/automacao-whatsapp/*` foi testado.
- Nenhuma exclusão real foi executada.
- Edição/exclusão de justificativa existente não foi executada porque o controller apaga o registro anterior, contrariando a ordem de não remover dados.
- Não foi executado teste destrutivo de cascata em aluno.

## 11. Priorização recomendada

### P0 — antes de produção

1. Bloquear edição de chamada confirmada no backend e frontend.
2. Impedir hard delete de aluno com histórico; adotar desativação lógica.
3. Desativar/remover as contas de QA somente após a análise solicitada.

### P1 — alta prioridade

1. Retornar `409` para duplicidades.
2. Retornar `404` quando `affectedRows = 0`.
3. Criar auditoria de frequência e configurações.
4. Corrigir botões aninhados.
5. Reconciliar migrations aplicadas no banco real.
6. Revisar índices duplicados.

### P2 — melhoria

1. Corrigir datas e rótulo da automação.
2. Adicionar filtro por professor e métricas médias.
3. Melhorar paginação/renderização das listas grandes.
4. Distribuir rate limit se houver múltiplas instâncias.
5. Avaliar streaming ou processamento assíncrono para Excel grande.

## 12. Conclusão

Os fluxos principais funcionam, a segurança básica está bem estruturada e a concorrência foi controlada corretamente. O desempenho atual é bom para o volume testado.

O risco decisivo é de integridade: uma chamada confirmada continua editável e pode divergir do histórico oficial. Somado ao risco de hard delete em alunos e à ausência de auditoria, isso impede recomendar produção neste momento.

Veredito: **adequado para homologação controlada; não aprovado para produção até concluir os itens P0**.
