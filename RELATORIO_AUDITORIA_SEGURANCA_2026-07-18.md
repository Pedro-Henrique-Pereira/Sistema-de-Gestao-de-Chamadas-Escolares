# Auditoria de Segurança — Sistema de Gestão de Chamadas Escolares

Data: 18/07/2026
Escopo: frontend React/Vite, API Node/Express, autenticação, autorização, dados enviados ao navegador, storage, cookies, CORS, CSRF, cache, logs, erros, dependências e contratos críticos.

## Resumo executivo

A auditoria encontrou riscos reais de exposição no navegador e de endurecimento insuficiente, mas não encontrou senha, hash, JWT, chave do banco ou segredo do backend sendo retornado pela API principal.

Os principais problemas corrigidos foram:

- dados de alunos atrasados e relatórios armazenados em `sessionStorage`;
- pesquisas por nome e contato enviadas em query strings;
- login rápido de desenvolvimento confiando em `Host` sem exigir conexão de loopback real;
- CORS permitindo faixas locais e previews Vercel não cadastrados explicitamente;
- falta de política uniforme de `no-store` e headers de segurança;
- respostas de automação contendo locks, tentativas, solicitante e erro interno;
- endpoint administrativo capaz de retornar o conjunto completo de alunos, responsáveis e equipe;
- metadados internos excessivos em respostas de usuário e chamadas confirmadas;
- logs de frontend com objetos de erro completos e scripts auxiliares com credenciais/dados;
- dependências com vulnerabilidades conhecidas;
- sessão invalidada após troca de senha sem encerrar corretamente a interface atual.

Após as correções:

- backend: 48/48 testes aprovados;
- frontend: 19/19 testes aprovados;
- build de produção Vite 7.3.6 aprovado;
- `npm audit --omit=dev`: 0 vulnerabilidades no backend e 0 no frontend;
- teste real de ExcelJS com `uuid` atualizado aprovado;
- bundle final: 0 ocorrências dos valores reais de `JWT_SECRET` e `DB_PASSWORD`;
- validação HTTP real confirmou `401`, `403`, CSRF, IDOR bloqueado, logout e `no-store`;
- validação em navegador confirmou tela de login funcional e console limpo em aba nova.

Este resultado reduz de forma importante a superfície de exposição, mas não significa segurança absoluta. Os riscos restantes estão documentados ao final.

## Arquitetura e autenticação verificadas

O frontend React utiliza uma camada central de API e envia requisições com `credentials: "include"`.

O backend utiliza:

- JWT assinado com `HS256`;
- JWT armazenado em cookie `HttpOnly`;
- `jti` vinculado à tabela `sessoes_ativas`;
- expiração de 24 horas;
- sessão única por usuário;
- consulta ao banco em toda requisição autenticada;
- RBAC no backend;
- token CSRF no padrão double-submit cookie;
- invalidação da sessão no logout, troca de senha e alteração administrativa de senha.

Não existe refresh token. A renovação indefinida de refresh token, portanto, não se aplica à arquitetura atual.

## Vulnerabilidades encontradas e correções

| Gravidade | Achado | Correção |
|---|---|---|
| Alta | Relatórios agregados e nomes de alunos atrasados persistiam em `sessionStorage` | Cache migrado para memória; caches legados são removidos ao iniciar, trocar usuário, expirar sessão e sair |
| Alta | Nome de aluno, responsável e contato podiam aparecer em URLs de pesquisa | Pesquisas migradas para POST com JSON e CSRF; GET legado rejeita `busca` pessoal |
| Alta | Login rápido podia confiar em cabeçalhos de localhost enviados por uma máquina remota | Passou a exigir IP remoto de loopback, host local, origem local e ambiente de desenvolvimento |
| Alta | Vite, `form-data` e `uuid` possuíam advisories conhecidos | Vite 7.3.6, plugin React 5.2.0, `form-data` 4.0.6 e `uuid` 11.1.1; auditoria final zerada |
| Alta | Endpoint administrativo raiz retornava turmas, alunos, responsáveis e equipe em uma resposta sem paginação | Endpoint removido; telas continuam usando endpoints separados e alunos paginados |
| Média | CORS aceitava rede local por regex e qualquer preview Vercel quando habilitado | Somente origens exatas; localhost apenas fora de produção; métodos e headers restritos |
| Média | API não aplicava `Cache-Control: no-store` de forma uniforme | Middleware global adicionou `no-store`, `Pragma`, `Expires` e headers defensivos |
| Média | Resposta de status da automação expunha solicitante, máquina, lock, tentativas, datas e erro bruto | DTO reduzido a `id`, `status` e `erro_publico` |
| Média | Respostas de sessão e chamadas continham metadados não usados | DTO explícito de usuário; remoção de campos internos de chamada/frequência/equipe |
| Média | Logs do frontend recebiam o objeto completo de erro | Logger sanitizado, ativo apenas em desenvolvimento e sem corpo de resposta |
| Média | Scripts auxiliares continham credenciais de teste e podiam imprimir linhas completas do banco | Credenciais passaram para variáveis de ambiente; visualização do banco mostra apenas contagens |
| Média | Troca de senha invalidava a sessão no banco, mas a UI permanecia com estado autenticado | Cookies são apagados e a interface exige novo login imediatamente |
| Baixa | JWT era verificado sem allowlist explícita de algoritmo | Verificação limitada a `HS256` |
| Baixa | Cookies inválidos podiam permanecer no navegador | Respostas 401 de autenticação limpam cookies de autenticação e CSRF |
| Baixa | Comparação do CSRF era direta | Comparação passou a usar `timingSafeEqual` |
| Baixa | `X-Powered-By` e headers defensivos estavam ausentes | Assinatura removida; CSP, HSTS, frame protection, nosniff, referrer e permissions policy adicionados |
| Baixa | `.secrets/` aparecia como arquivo não rastreado | Diretório adicionado ao `.gitignore`; nenhum conteúdo foi publicado |

## Dados que deixaram de ser expostos

- relatórios agregados persistidos em `sessionStorage`;
- nomes, turmas e horários de alunos atrasados persistidos em `sessionStorage`;
- termos pessoais de pesquisa em URL/histórico;
- `ativo` e `criado_em` no endpoint `/api/auth/me`;
- campo vazio `senha` em respostas da equipe;
- solicitante, lock, tentativas, máquina, timestamps e erro interno da automação;
- IDs de auditoria e metadados de justificativa não usados na tela;
- lista completa de alunos/responsáveis no endpoint administrativo raiz;
- lista completa de alunos devolvida após remover uma turma;
- mensagens e objetos completos em logs de frontend;
- detalhes completos do banco em script de inspeção.

Dados necessários às telas de administrador e pedagoga, como nome e contato de responsáveis, continuam visíveis na aba Network para usuários autorizados. Isso é inevitável para a funcionalidade e foi mantido apenas nos endpoints e perfis que realmente usam esses dados.

## Cookies, CSRF, CORS e cache

Cookie de autenticação:

- `HttpOnly: true`;
- `Secure: true` em produção;
- `SameSite=None` em produção para Vercel/Railway;
- `SameSite=Strict` em desenvolvimento local;
- `Path=/`;
- host-only, sem `Domain`;
- prioridade alta.

Cookie CSRF:

- acessível ao JavaScript por necessidade do padrão double-submit;
- `Secure` e `SameSite` equivalentes ao cookie de autenticação;
- não autentica o usuário;
- validado também em header;
- comparado de forma constante.

CORS:

- credenciais permitidas somente para origens exatas;
- sem `Access-Control-Allow-Origin: *`;
- previews e IPs locais não são aceitos por curingas;
- origens adicionais devem ser cadastradas explicitamente em `FRONTEND_URLS_EXTRAS`.

Cache:

- todas as respostas da API usam `Cache-Control: no-store, max-age=0`;
- `Pragma: no-cache` e `Expires: 0`;
- dados privados de interface ficam somente em memória;
- logout, expiração e troca de usuário limpam caches privados e persistência legada.

## Alterações de contrato da API

Consumidores do próprio repositório foram atualizados.

- `POST /api/registros/alunos/pesquisar`: paginação e busca pessoal no corpo;
- `POST /api/pedagoga/responsaveis/pesquisar`: paginação e busca pessoal no corpo;
- `POST /api/relatorios/filtros/alunos`: turma e nome no corpo;
- GETs legados rejeitam `busca` pessoal;
- `GET /api/registros` foi removido por retornar dataset completo e não possuir consumidor;
- status de automação passou a retornar apenas DTO público;
- `/api/auth/me` passou a retornar somente `id`, `nome`, `email` e `tipo`;
- troca de senha passou a retornar `sessaoEncerrada: true`.

## Regras de autorização validadas

Validação automatizada e/ou HTTP real:

- rota administrativa sem autenticação: `401`;
- professor em rota administrativa: `403`;
- pedagoga em endpoint de equipe administrativa: `403`;
- mutação sem CSRF: `403`;
- professor editando chamada de outro professor: `403`;
- professor não edita chamada confirmada;
- professor só edita sua chamada temporária;
- pedagoga edita chamada confirmada até o horário limite;
- pedagoga é bloqueada após o horário limite;
- automação é bloqueada antes e liberada depois do horário limite;
- versão desatualizada da chamada é rejeitada;
- lista incompleta, duplicada ou com aluno externo é rejeitada;
- logout retorna `200`;
- reutilização da sessão após logout retorna `401`;
- alteração manual de `role` no frontend não concede permissão, pois o backend usa o perfil da sessão/banco.

## Testes criados

Backend:

- cookies de produção;
- DTO de usuário sem senha, hash ou token;
- DTO de automação sem metadados internos;
- login rápido restrito a loopback;
- comparação CSRF;
- headers e `no-store`;
- limite máximo de senha.

Frontend:

- cache privado somente em memória;
- limpeza de caches legados no logout;
- preservação apenas da mensagem não sensível de sessão;
- HTTPS obrigatório para API externa;
- HTTP permitido somente em loopback para validação local.

## Testes executados

- `npm.cmd test` no backend: 48 aprovados;
- `npm.cmd test` no frontend: 19 aprovados;
- `npm.cmd run build`: aprovado com Vite 7.3.6;
- `npm.cmd audit --omit=dev --json` no backend: 0 vulnerabilidades;
- `npm.cmd audit --omit=dev --json` no frontend: 0 vulnerabilidades;
- `node --check` nos arquivos backend alterados: aprovado;
- `git diff --check`: aprovado;
- parsing de JSON de manifests e `vercel.json`: aprovado;
- ExcelJS + `uuid` 11.1.1: workbook gerado com sucesso;
- scan do bundle contra valores reais de `JWT_SECRET` e `DB_PASSWORD`: 0 ocorrências;
- busca estática por JWT/senha/token em URL: nenhuma ocorrência;
- busca por `SELECT *` em código do backend: nenhuma ocorrência;
- navegador local: login renderizado e aba nova sem erros ou warnings no console.

Os testes HTTP reais utilizaram contas QA existentes e alteraram apenas sessões transitórias, removidas no logout. Nenhum aluno, responsável, chamada, frequência, justificativa ou fila de automação foi modificado.

## Arquivos de segurança criados

Backend:

- `backend/src/middlewares/securityHeaders.js`;
- `backend/src/utils/authCookies.js`;
- `backend/src/utils/devAccess.js`;
- `backend/src/utils/publicDtos.js`;
- `backend/src/tests/securityHardening.test.js`.

Frontend:

- `frontend/src/utils/privateDataCache.js`;
- `frontend/src/utils/clientLogger.js`;
- `frontend/src/utils/apiUrlSecurity.js`;
- `frontend/src/tests/privateDataCache.test.js`;
- `frontend/src/tests/apiUrlSecurity.test.js`.

Também foram alterados controladores, rotas, serviços de API, contexto de autenticação, páginas consumidoras, configurações de deploy, scripts auxiliares e lockfiles relacionados aos achados descritos.

## Riscos restantes e recomendações

1. **Vínculo professor-turma — médio:** o schema atual não possui uma tabela que associe professores às turmas autorizadas. O backend protege propriedade da chamada, mas um professor autenticado ainda pode consultar turmas disponíveis e criar chamada para qualquer turma ainda livre. Se a política escolar exigir turmas atribuídas, será necessária uma migration e autorização por vínculo.

2. **CSP do frontend — baixo/médio:** `connect-src` aceita HTTPS de forma ampla para manter compatibilidade com a URL variável do Railway. Quando o domínio definitivo da API for estável, restringir ao host exato.

3. **Validação pós-deploy — necessária:** confirmar no ambiente real Vercel/Railway os headers, `Secure`, `SameSite=None`, origem CORS exata, logout, F5 e botão voltar. O comportamento local e as configurações foram validados, mas o proxy final pode adicionar ou substituir headers.

4. **Dados necessários continuam visíveis:** tudo que a tela precisa renderizar permanece visível na aba Network do usuário autorizado. A proteção correta é RBAC, propriedade e minimização, não ocultação de endpoint.

5. **Banco e backups:** criptografia em repouso, retenção de backups, contas MySQL e controles do provedor não puderam ser comprovados apenas pelo repositório. Devem ser auditados no Railway.

6. **WhatsApp real:** a automação não foi disparada nesta auditoria para não enviar mensagens reais. O bloqueio temporal e a autorização foram cobertos por testes.

7. **Revisão periódica:** executar `npm audit`, scan de bundle e testes de RBAC em toda atualização de dependências ou alteração de contrato.

## Conclusão

O sistema está significativamente mais protegido contra exposição acidental no navegador, abuso de sessão, IDOR em chamadas, CSRF, CORS amplo, cache privado, respostas excessivas e vazamento por logs/scripts.

Não há vulnerabilidade crítica conhecida aberta no escopo auditado. A principal pendência arquitetural é definir se professores devem possuir vínculo formal com turmas; sem essa regra no banco, não é possível impor esse isolamento sem alterar o modelo de negócio.
