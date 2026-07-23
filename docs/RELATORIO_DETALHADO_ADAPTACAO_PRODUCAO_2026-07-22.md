# Relatório técnico detalhado da adaptação para produção

**Projeto:** Sistema de Gerenciamento de Chamadas Escolares
**Data da adaptação:** 22 de julho de 2026
**Ambiente-alvo:** Ubuntu Server próprio da escola
**Domínios:** `https://lysimaco.com.br` e `https://www.lysimaco.com.br`
**Tecnologias de infraestrutura:** Docker, Docker Compose, Nginx, MySQL e Cloudflare Tunnel

---

## 1. Objetivo da alteração

O objetivo foi preparar somente o sistema web para operar em produção em um
servidor físico da escola, sem depender da hospedagem anterior em
Railway/Vercel e sem incluir o aplicativo desktop de automação nas imagens ou
nos serviços do servidor.

A solução precisava atender aos seguintes requisitos:

- frontend React/Vite servido por Nginx;
- backend Node.js/Express em container separado;
- MySQL em container separado e com armazenamento persistente;
- acesso público exclusivamente por Cloudflare Tunnel;
- nenhum acesso público direto ao backend ou ao banco;
- segredos armazenados somente no Ubuntu Server;
- inicialização automática depois de reinício do servidor;
- deploy remoto depois de commits na branch `main`;
- rollback sem apagar banco, ambientes ou credenciais;
- preservação integral do aplicativo `lysimaco-automacao-app/`.

---

## 2. Escopo efetivamente executado

Foram alterados somente:

- configuração de produção do backend;
- configuração do cliente HTTP do frontend;
- cookies, CORS, proxy e healthchecks;
- arquivos Docker e Nginx;
- scripts de deploy e rollback;
- workflow de deploy do GitHub Actions;
- exemplos de ambiente;
- documentação operacional e de segurança;
- testes diretamente relacionados às novas configurações.

Não foram alteradas regras de negócio de:

- chamadas escolares;
- confirmação de chamadas;
- justificativas;
- cálculo de atrasos;
- relatórios;
- permissões de administrador, pedagoga e professor;
- recuperação de senha;
- auditoria;
- fila ou contrato da automação desktop.

---

## 3. Arquitetura final adotada

```text
Usuário no navegador
        |
        | HTTPS
        v
Cloudflare / Cloudflare Tunnel
        |
        | conexão privada iniciada pelo cloudflared
        v
Container frontend — Nginx :80
        |
        | /api/* pela rede Docker
        v
Container backend — Node.js/Express :3000
        |
        | conexão MySQL pela rede interna "data"
        v
Container MySQL :3306
        |
        v
Volume Docker persistente mysql_data
```

### 3.1 Motivos dessa arquitetura

- O Cloudflare Tunnel elimina a necessidade de publicar portas HTTP/HTTPS da
  aplicação no roteador da escola.
- O frontend é o único destino acessível pelo Tunnel.
- O Nginx centraliza arquivos estáticos, fallback das rotas React e proxy da
  API.
- O backend não recebe conexões diretamente da internet.
- O MySQL aceita conexões apenas pela rede Docker usada pelo backend.
- O volume do banco existe fora do ciclo de vida do container MySQL.
- Os containers são imutáveis: nenhum deles clona Git, executa deploy ou recebe
  o Docker socket do host.

### 3.2 Redes Docker

O Compose possui três redes com responsabilidades distintas:

- `data`: rede interna usada por backend e MySQL;
- `app`: comunicação entre frontend e backend e saída necessária do backend,
  inclusive para o SMTP da recuperação de senha;
- `edge`: comunicação entre cloudflared e frontend.

Não existe nenhuma declaração `ports:` no Compose. As portas exibidas pelo
Docker são apenas portas internas dos containers e não são vinculadas ao host.

---

## 4. Arquivos criados

### 4.1 `.dockerignore`

Criado para reduzir o contexto enviado ao Docker e impedir a inclusão de itens
locais ou sensíveis.

Principais exclusões:

- `.git`, `.github`, `.codex` e arquivos de ferramentas;
- `.env`, `config.env`, chaves e credenciais do Cloudflare;
- `node_modules`, `dist`, builds, cobertura e logs;
- volumes, banco local e backups;
- `lysimaco-automacao-app/` completo.

Os Dockerfiles também usam cópias seletivas. Portanto, a automação é protegida
por duas camadas: exclusão no contexto e ausência de instrução `COPY` que possa
incluí-la.

### 4.2 `.env.production.example`

Criado como referência única, sem segredos verdadeiros, para montar os dois
arquivos externos do servidor:

```text
/opt/lysimaco/env/backend.env
/opt/lysimaco/env/mysql.env
```

O exemplo contém:

- ambiente e porta do backend;
- conexão MySQL por `DB_HOST=mysql`;
- allowlist dos dois domínios;
- URL pública usada nos e-mails;
- proxy confiável;
- opções seguras de cookie;
- JWT fictício a ser substituído;
- usuário MySQL específico da aplicação;
- senha root separada e apenas para administração do banco.

O arquivo real não deve ser copiado para o repositório.

### 4.3 `backend/Dockerfile`

Foi criada uma imagem de backend em dois estágios:

1. `dependencies`: instala somente dependências de produção com
   `npm ci --omit=dev`;
2. `runtime`: recebe apenas `node_modules`, `package.json` e `backend/src`.

Características de segurança e operação:

- base Node `22.23.1-alpine3.23` fixada;
- execução com o usuário não-root `node`;
- porta interna `3000`;
- healthcheck em `GET /api/health`;
- nenhum `.env` copiado;
- nenhum código do frontend ou da automação copiado;
- comando final `node src/server.js`.

### 4.4 `frontend/Dockerfile`

Foi criada uma imagem multi-stage:

1. estágio Node instala dependências e executa o build Vite;
2. estágio Nginx recebe somente o diretório `dist` e a configuração Nginx.

Características:

- Node `22.23.1-alpine3.23` no build;
- Nginx `1.28.3-alpine3.23` no runtime;
- `VITE_API_URL=/api` como argumento de build;
- imagem final sem `node_modules` e sem código-fonte React;
- healthcheck interno em `/healthz`;
- nenhum segredo em variável `VITE_*`.

### 4.5 `frontend/nginx.conf`

O Nginx foi configurado para:

- servir o build em `/usr/share/nginx/html`;
- encaminhar `/api/*` para `http://backend:3000`;
- preservar `Host`, `X-Real-IP`, `X-Forwarded-For`,
  `X-Forwarded-Proto` e `X-Forwarded-Host`;
- usar `try_files $uri $uri/ /index.html` nas rotas React;
- responder `/healthz` sem acessar backend ou banco;
- bloquear caminhos de arquivos ocultos;
- aplicar cache longo somente em assets versionados;
- impedir cache do HTML principal;
- ocultar a versão do Nginx;
- aplicar headers contra sniffing, framing e acesso indevido a recursos do
  navegador;
- redirecionar `www.lysimaco.com.br` para `https://lysimaco.com.br` com HTTP
  308.

O `proxy_pass` não remove o prefixo `/api`, preservando exatamente as rotas já
existentes do Express.

### 4.6 `docker-compose.prod.yml`

Criado como orquestrador oficial de produção.

#### Serviço `mysql`

- imagem `mysql:8.4.10`;
- `restart: unless-stopped`;
- ambiente externo configurável por `MYSQL_ENV_FILE`;
- charset `utf8mb4` e collation `utf8mb4_unicode_ci`;
- volume nomeado `mysql_data`;
- acesso somente pela rede interna `data`;
- healthcheck executando `SELECT 1` com o usuário da aplicação;
- sem publicação de `3306` ou `33060` no host;
- `no-new-privileges` ativado.

#### Serviço `backend`

- build pelo `backend/Dockerfile`;
- ambiente externo configurável por `BACKEND_ENV_FILE`;
- `NODE_ENV=production`;
- `PORT=3000`;
- `DB_HOST=mysql` e `DB_PORT=3306` impostos pelo Compose;
- início condicionado ao MySQL saudável;
- acesso às redes `data` e `app`;
- filesystem somente leitura, com `/tmp` temporário;
- `init: true` para encaminhamento correto de sinais;
- healthcheck usando `/api/ready`;
- sem publicação de porta no host.

#### Serviço `frontend`

- build pelo `frontend/Dockerfile`;
- build arg `VITE_API_URL=/api`;
- início condicionado ao backend saudável;
- participação nas redes `app` e `edge`;
- healthcheck em `/healthz`;
- sem publicação de porta no host.

#### Serviço `cloudflared`

- imagem `cloudflare/cloudflared:2026.7.2` fixada;
- configuração e credencial montadas como somente leitura;
- diretório padrão `/opt/lysimaco/cloudflare`;
- início condicionado ao frontend saudável;
- acesso somente à rede `edge`;
- nenhum token ou JSON de credencial versionado.

### 4.7 `deploy/cloudflare/config.yml.example`

Criado como modelo de configuração do Tunnel.

Ingressos previstos:

```yaml
- hostname: lysimaco.com.br
  service: http://frontend:80
- hostname: www.lysimaco.com.br
  service: http://frontend:80
- service: http_status:404
```

O identificador do Tunnel e o nome do JSON são marcadores explícitos. Nenhuma
credencial falsa com aparência real foi criada.

### 4.8 `deploy/deploy.sh`

Criado para executar o deploy no Ubuntu Server.

Fluxo detalhado:

1. ativa `set -Eeuo pipefail`;
2. usa `flock` para impedir deploys concorrentes;
3. entra exclusivamente em `/opt/lysimaco/app`;
4. registra o SHA instalado;
5. executa `git fetch --prune origin main`;
6. verifica se o SHA recebido pelo GitHub corresponde a `origin/main`;
7. grava o SHA anterior em `/opt/lysimaco/state/previous.sha`;
8. atualiza somente a cópia Git com `git reset --hard`;
9. executa `docker compose build --pull`;
10. sobe os serviços com `up -d --remove-orphans`;
11. aguarda MySQL, backend e frontend ficarem `healthy`;
12. registra o novo SHA em `current.sha`;
13. chama rollback automaticamente se build, subida ou saúde falharem.

O script não executa:

- `docker volume prune`;
- remoção do volume MySQL;
- remoção de `/opt/lysimaco/env`;
- remoção das credenciais Cloudflare;
- migrations automáticas;
- limpeza ampla do sistema de arquivos.

### 4.9 `deploy/rollback.sh`

Criado para retornar ao último SHA conhecido ou a um SHA informado pelo
operador.

O rollback:

- usa o mesmo lock do deploy;
- valida se o SHA existe como commit Git;
- altera somente a cópia em `/opt/lysimaco/app`;
- reconstrói frontend e backend;
- mantém `mysql_data` intacto;
- mantém ambientes e credenciais externos;
- espera novamente os três healthchecks;
- registra o SHA restaurado;
- falha claramente se algum serviço não ficar saudável.

O rollback da aplicação não tenta desfazer migrations. Essa separação evita
mascarar alterações incompatíveis de schema.

### 4.10 `deploy/README.md`

Criado como guia curto para o operador do servidor. Documenta:

- preparo de `/opt/lysimaco`;
- localização de ambientes e credenciais;
- primeira subida;
- deploy e rollback manual;
- secrets exigidos pelo GitHub;
- validação confiável da chave SSH do host.

### 4.11 `.github/workflows/deploy-production.yml`

Criado para automatizar deploy somente depois de push na `main`.

O job `test`:

- baixa o repositório;
- configura Node 22;
- executa `npm ci` e testes do backend;
- executa `npm ci`, testes e build do frontend;
- compila o frontend com `VITE_API_URL=/api`.

O job `deploy`:

- depende integralmente do job de testes;
- usa o environment `production`;
- impede deploys simultâneos com `concurrency`;
- lê host, porta, usuário, chave e diretório somente de GitHub Secrets;
- exige `PRODUCTION_KNOWN_HOSTS` previamente conferido;
- usa `StrictHostKeyChecking=yes`;
- chama `deploy/deploy.sh` com o SHA exato do workflow.

Secrets previstos:

- `PRODUCTION_HOST`;
- `PRODUCTION_PORT`;
- `PRODUCTION_USER`;
- `PRODUCTION_SSH_KEY`;
- `PRODUCTION_APP_DIR`;
- `PRODUCTION_KNOWN_HOSTS`.

### 4.12 `docs/HOSPEDAGEM_PRODUCAO.md`

Criado como manual operacional completo. Contém:

- arquitetura;
- estrutura de diretórios do Ubuntu;
- separação dos ambientes;
- criação e configuração do Cloudflare Tunnel;
- primeira inicialização;
- reinício automático;
- deploy;
- rollback;
- SSH, UFW e opções de VPN/Access;
- backups;
- política de migrations;
- comandos de verificação no servidor.

### 4.13 Relatórios da adaptação

Foram criados:

- `docs/RELATORIO_ADAPTACAO_PRODUCAO_2026-07-22.md`, com resumo executivo;
- este relatório detalhado, com o inventário técnico e as evidências completas.

---

## 5. Arquivos existentes que foram modificados

### 5.1 `.gitignore`

Foi adicionada uma exceção para permitir versionar somente o exemplo seguro
`.env.production.example`, mantendo `.env`, `.env.*`, `config.env`, chaves,
credenciais Cloudflare e certificados reais ignorados.

### 5.2 `README.md`

Foi adicionada uma nota informando que o ambiente-alvo atual é o servidor
Ubuntu próprio com Docker e Cloudflare Tunnel.

As referências a Railway/Vercel passaram a ser tratadas como hospedagem legada,
e `docs/HOSPEDAGEM_PRODUCAO.md` foi indicada como fonte operacional atual.

### 5.3 `backend/.env.exemple`

O exemplo do backend passou a documentar:

- `PORT=3000`;
- `ALLOWED_ORIGINS` com os dois domínios;
- `FRONTEND_URL=https://lysimaco.com.br`;
- `TRUST_PROXY=1`;
- `COOKIE_SECURE=true`;
- `COOKIE_SAME_SITE=lax`;
- URL pública correta para recuperação de senha.

Os valores continuam fictícios e devem ser substituídos no servidor.

### 5.4 `backend/src/config/runtimeConfig.js`

Novo módulo de configuração criado para retirar regras de ambiente de dentro do
servidor principal.

Responsabilidades:

- separar listas de origens por vírgula;
- montar a allowlist de produção;
- preservar origens localhost somente em desenvolvimento;
- verificar uma origem recebida pelo CORS;
- interpretar `TRUST_PROXY`;
- manter compatibilidade temporária com `TRUST_PROXY_HOPS`, `FRONTEND_URL` e
  `FRONTEND_URLS_EXTRAS`.

Em produção, quando não existir configuração legada ou explícita, os padrões
seguros são somente:

- `https://lysimaco.com.br`;
- `https://www.lysimaco.com.br`.

### 5.5 `backend/src/server.js`

As mudanças foram localizadas e preservaram todas as rotas existentes.

Alterações:

- uso do novo módulo `runtimeConfig`;
- remoção da URL Vercel fixa da allowlist;
- CORS baseado em `ALLOWED_ORIGINS`;
- `app.set("trust proxy", ...)` em produção;
- inclusão de `GET /api/health`;
- inclusão de `GET /api/ready`;
- armazenamento do retorno de `app.listen` para permitir encerramento;
- tratamento único de `SIGTERM` e `SIGINT`;
- prazo máximo de dez segundos para shutdown;
- parada de novas conexões HTTP;
- espera das requisições em andamento;
- fechamento de `pool.end()` antes da saída.

As rotas existentes continuam com o prefixo `/api`, incluindo autenticação,
chamadas, registros, usuários, pedagoga, administração, relatórios,
configurações, mensagens e automação.

### 5.6 `backend/src/controllers/healthController.js`

Novo controller responsável por duas verificações distintas:

- `/api/health`: retorna apenas `{ "status": "ok" }` quando o processo está
  executando;
- `/api/ready`: executa `SELECT 1` no pool e retorna `ready` ou HTTP 503.

Falhas do banco não retornam senha, host, query, stack trace ou mensagem interna.

### 5.7 `backend/src/utils/authCookies.js`

Os cookies foram ajustados ao modelo same-origin adotado pelo Nginx.

Comportamento em produção:

- cookie JWT: `HttpOnly=true`;
- cookie JWT e CSRF: `Secure=true`;
- `SameSite=Lax` por padrão;
- `Path=/`;
- nenhum `Domain=.lysimaco.com.br` amplo;
- mesma função de opções usada na criação e na limpeza.

`COOKIE_SAME_SITE` aceita apenas `lax`, `strict` ou `none`. O backend força
cookie seguro em produção mesmo que uma configuração insegura seja omitida.

### 5.8 `backend/src/tests/securityHardening.test.js`

Foram acrescentados testes para:

- aceitar os dois domínios oficiais;
- rejeitar origem externa;
- continuar aceitando requisições sem `Origin`, necessárias para comunicação
  servidor-a-servidor;
- confirmar `SameSite=Lax` em produção;
- confirmar `/api/ready` saudável com banco disponível;
- confirmar HTTP 503 sem vazamento do erro quando o banco falha.

### 5.9 `frontend/.env.exemple`

O valor passou de vazio para:

```env
VITE_API_URL=/api
```

Isso elimina dependência de `localhost` em produção.

### 5.10 `frontend/src/services/api.js`

O cliente HTTP centralizado foi adaptado para operar no mesmo domínio.

Antes, o arquivo exigia uma URL absoluta e sempre acrescentava `/api` ao
endpoint. Se fosse configurado diretamente com `/api`, poderia gerar caminhos
como `/api/api/auth`.

Depois da alteração:

- `/api` é o valor padrão;
- bases absolutas antigas continuam compatíveis;
- bases absolutas terminadas em `/api` continuam compatíveis;
- o prefixo não é duplicado;
- cookies continuam enviados com `credentials: "include"`;
- CSRF continua enviado nos métodos mutáveis;
- tratamento existente de 401 e falhas permanece centralizado.

### 5.11 `frontend/src/utils/apiUrlSecurity.js`

A validação de URL de produção passou a aceitar caminhos relativos same-origin,
como `/api`, mas continua rejeitando:

- HTTP externo;
- valores inválidos;
- URLs protocol-relative como `//servidor-externo/api`.

HTTPS absoluto e HTTP de loopback para desenvolvimento continuam aceitos.

### 5.12 `frontend/src/tests/apiUrlSecurity.test.js`

Foram adicionados casos que comprovam:

- `/api` é seguro;
- `//externo.example/api` é rejeitado.

---

## 6. CORS, cookies, proxy e CSRF

### 6.1 CORS

Allowlist oficial:

```text
https://lysimaco.com.br
https://www.lysimaco.com.br
```

Não foi usado `origin: "*"`. `credentials: true` foi preservado porque a
autenticação usa cookie e o frontend envia credenciais.

Origens localhost são adicionadas somente quando `NODE_ENV` não é
`production`.

### 6.2 Cookies

O JWT permanece em cookie HttpOnly; não foi movido para `localStorage` nem
`sessionStorage`.

O token CSRF continua acessível ao JavaScript porque precisa ser repetido no
header `X-CSRF-Token`, mas não funciona como credencial de autenticação sozinho.

### 6.3 Proxy

O backend confia em um salto de proxy por padrão. No fluxo Docker, o Express
recebe a requisição do Nginx, que preserva o protocolo informado pelo Tunnel.
Isso permite que o backend reconheça a origem HTTPS pública mesmo recebendo HTTP
na rede privada.

### 6.4 Headers

O Nginx aplica:

- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy`;
- `Permissions-Policy`;
- HSTS.

O middleware já existente do backend continua aplicando headers defensivos e
`Cache-Control: no-store` nas respostas da API.

---

## 7. Banco de dados e persistência

O backend usa:

```env
DB_HOST=mysql
DB_PORT=3306
DB_NAME=sistema_chamadas
DB_USER=sistema_chamadas_app
DB_PASSWORD=<segredo do servidor>
```

O usuário da aplicação não é root. O root existe apenas para administração e
inicialização do container MySQL.

O volume persistente é:

```text
mysql_data:/var/lib/mysql
```

O deploy e o rollback não removem esse volume. Também não existe comando de
prune de volumes nos scripts.

Migrations permanecem versionadas em `backend/src/database/migrations`, mas não
são executadas automaticamente. Isso foi deliberado porque uma migration de
schema pode impedir uma versão anterior do backend de funcionar depois do
rollback.

---

## 8. Segredos e arquivos externos

Nenhum segredo real foi adicionado ao repositório.

Arquivos reais esperados:

```text
/opt/lysimaco/env/backend.env
/opt/lysimaco/env/mysql.env
/opt/lysimaco/cloudflare/config.yml
/opt/lysimaco/cloudflare/<TUNNEL_ID>.json
```

Permissões recomendadas:

```bash
sudo chown root:deploy /opt/lysimaco/env/*.env
sudo chown root:deploy /opt/lysimaco/cloudflare/*
sudo chmod 600 /opt/lysimaco/env/*.env
sudo chmod 600 /opt/lysimaco/cloudflare/*.json
```

O GitHub recebe somente a chave SSH de deploy e os dados de conexão como
secrets. A chave privada do servidor e a credencial do Tunnel não entram no
frontend, backend ou imagens Docker.

---

## 9. Inicialização automática

Todos os serviços usam:

```yaml
restart: unless-stopped
```

No Ubuntu, o Docker deve ser habilitado com:

```bash
sudo systemctl enable --now docker
```

Depois de um reboot, o Docker restaura os containers. A ordem operacional é
controlada por healthchecks:

1. MySQL saudável;
2. backend pronto e conectado ao MySQL;
3. frontend saudável;
4. cloudflared iniciado depois do frontend.

Não foi usado atraso fixo como mecanismo principal de sincronização.

---

## 10. Processo de deploy remoto

```text
Commit na main
  -> GitHub Actions
  -> testes backend/frontend
  -> build frontend
  -> SSH com chave e host validado
  -> deploy/deploy.sh no Ubuntu
  -> git fetch origin/main
  -> validação do SHA
  -> build das imagens
  -> docker compose up
  -> healthchecks
  -> registro do SHA implantado
```

O servidor necessita de uma deploy key Git apenas de leitura para buscar o
repositório. O GitHub Actions necessita de uma chave SSH capaz de chamar o
script no servidor.

O usuário de deploy precisa controlar Docker. Essa permissão é equivalente a
privilégio administrativo e deve ser limitada a essa conta, nunca concedida a
usuários comuns do sistema escolar.

---

## 11. Processo de rollback

Rollback manual:

```bash
cd /opt/lysimaco/app
PRODUCTION_APP_DIR=/opt/lysimaco/app bash deploy/rollback.sh <SHA_ANTERIOR>
```

Rollback usando o último SHA registrado:

```bash
cd /opt/lysimaco/app
PRODUCTION_APP_DIR=/opt/lysimaco/app bash deploy/rollback.sh
```

O rollback troca somente código e imagens da aplicação. Ele não remove:

- dados MySQL;
- volume Docker;
- `.env` externos;
- credenciais Cloudflare;
- backups;
- estado SSH do servidor.

---

## 12. SSH e segurança operacional

Recomendações documentadas:

- usuário administrativo separado do usuário de deploy;
- login root desativado;
- autenticação por senha desativada somente depois de validar a chave;
- `PubkeyAuthentication yes`;
- UFW com política de entrada bloqueada;
- Fail2ban ou proteção equivalente;
- preferência por Tailscale, WireGuard ou Cloudflare Access;
- MySQL, backend e painel Docker nunca expostos;
- Docker socket nunca montado em frontend ou backend;
- chave do host armazenada em `PRODUCTION_KNOWN_HOSTS` e conferida por canal
  confiável.

Nenhum arquivo do projeto altera automaticamente o `sshd_config` real.

---

## 13. Testes e validações executados

### 13.1 Testes automatizados

| Validação | Resultado |
| --- | --- |
| Testes do backend | 101 aprovados, 0 falhas |
| Testes do frontend | 29 aprovados, 0 falhas |
| Build Vite local | aprovado |
| Verificação de sintaxe Node | aprovada |
| `git diff --check` | aprovado |
| Sintaxe dos scripts Bash | aprovada com `bash -n` |
| Resolução do Compose | aprovada com `docker compose config --quiet` |

### 13.2 Build Docker

As imagens abaixo foram construídas com sucesso:

- `lysimaco-backend`;
- `lysimaco-frontend`.

O contexto enviado ao Docker ficou restrito aos arquivos necessários, e a
automação desktop não foi incluída.

### 13.3 Teste integrado em Compose isolado

Foi criado um projeto Compose temporário, com senhas exclusivamente de teste e
volume separado.

Resultados:

- MySQL ficou `healthy`;
- backend ficou `healthy`;
- frontend ficou `healthy`;
- `/healthz` respondeu `ok`;
- Nginx encaminhou `/api/health` e recebeu `{ "status": "ok" }`;
- rota interna React retornou `index.html` em vez de HTTP 404;
- `https://lysimaco.com.br` foi aceito pelo CORS;
- `https://www.lysimaco.com.br` foi aceito pelo CORS;
- `https://externo.example` recebeu HTTP 403 sem header de liberação;
- MySQL preservou um marcador depois de o container ser recriado;
- nenhum serviço apresentou binding de porta no host;
- os três serviços usaram `unless-stopped`;
- backend voltou a `healthy` depois de reinício;
- a pasta da automação não existia dentro das imagens.

Depois dos testes foram removidos:

- containers temporários;
- redes temporárias;
- volume MySQL temporário;
- ambientes fictícios temporários;
- tags de imagens duplicadas usadas apenas pelo teste.

As imagens finais de build foram preservadas localmente como evidência.

---

## 14. Arquivos e mudanças anteriores preservadas

Antes desta adaptação, a worktree já possuía alterações locais em arquivos do
backend relacionados à automação e dentro de `lysimaco-automacao-app/`.

Essas alterações anteriores foram preservadas e não foram incorporadas como
parte desta adaptação de hospedagem.

Também já existiam como arquivos locais não rastreados:

- `HOSPEDAGEM_PRODUCAO_SISTEMA_CHAMADA.md`;
- `RELATORIO_FLUXO_REAL_2026-07-22.md`.

Eles não foram sobrescritos pelo relatório detalhado.

---

## 15. Confirmação sobre a automação desktop

A pasta real identificada foi:

```text
lysimaco-automacao-app/
```

Confirmações:

- não foi movida;
- não foi renomeada;
- não foi excluída;
- não foi refatorada pela adaptação de hospedagem;
- não foi adicionada ao Compose;
- não foi copiada para o backend;
- não foi copiada para o frontend;
- não apareceu nas imagens construídas;
- foi adicionada ao `.dockerignore`.

O sistema web continua podendo se comunicar com o aplicativo desktop pelos
contratos de API já existentes, mas o aplicativo permanece executado fora do
servidor web.

---

## 16. Riscos encontrados

### 16.1 Advisories npm no backend

Durante `npm ci --omit=dev`, o npm informou:

- 1 advisory de severidade baixa;
- 2 advisories de severidade alta.

A árvore local mostra dependências antigas transitivas principalmente abaixo de
`exceljs`. A consulta detalhada com `npm audit --json` não foi executada porque
ela envia metadados da árvore para um serviço externo e essa autorização não
foi concedida durante a execução.

Recomendação:

- tratar os advisories antes da abertura pública;
- analisar cada caminho transitivo;
- atualizar primeiro em branch separada;
- revalidar exportações Excel;
- não executar `npm audit fix --force` automaticamente.

### 16.2 Etapas dependentes do ambiente real

Ainda não puderam ser comprovadas localmente:

- DNS público dos dois domínios;
- criação real do Cloudflare Tunnel;
- funcionamento das credenciais reais do Tunnel;
- envio SMTP em produção;
- acesso SSH real;
- UFW e política do servidor;
- secrets do GitHub;
- deploy disparado por push real na `main`;
- rollback real depois de uma falha controlada;
- reboot físico do Ubuntu;
- restauração real de backup MySQL.

### 16.3 Validação funcional com dados reais

As suítes automatizadas passaram, mas antes da abertura pública ainda deve ser
feita validação manual com uma cópia segura do banco:

- login e logout;
- expiração e invalidação de sessão;
- administrador;
- pedagoga;
- professor;
- criação e confirmação de chamada;
- edição antes e depois do horário limite;
- justificativas;
- atrasos;
- relatórios e exportação Excel;
- recuperação de senha;
- logs de auditoria;
- comunicação da API com a futura automação desktop.

---

## 17. Checklist de aceite

### Concluído tecnicamente

- [x] containers separados para frontend, backend e MySQL;
- [x] serviço cloudflared separado;
- [x] MySQL persistente;
- [x] backend e MySQL sem portas públicas;
- [x] API preservada em `/api`;
- [x] CORS com allowlist exata;
- [x] frontend sem localhost em produção;
- [x] fallback das rotas React;
- [x] cookies seguros;
- [x] CSRF preservado;
- [x] healthcheck e readiness;
- [x] shutdown de SIGTERM/SIGINT;
- [x] inicialização por `unless-stopped`;
- [x] deploy remoto por GitHub Actions e SSH;
- [x] rollback preservando banco e segredos;
- [x] documentação de SSH, Cloudflare e ambientes;
- [x] automação desktop excluída das imagens;
- [x] testes locais e integrados aprovados.

### Pendente no servidor real

- [ ] instalar e endurecer o Ubuntu Server;
- [ ] criar os ambientes reais;
- [ ] criar o Tunnel e instalar a credencial;
- [ ] configurar DNS e HTTPS;
- [ ] configurar usuário e chave SSH;
- [ ] cadastrar secrets do GitHub;
- [ ] tratar os advisories npm;
- [ ] aplicar migrations necessárias com backup;
- [ ] executar primeiro deploy em janela controlada;
- [ ] validar rollback real;
- [ ] reiniciar o Ubuntu e confirmar recuperação;
- [ ] validar todos os fluxos com usuários reais de teste;
- [ ] configurar e testar backups.

---

## 18. Comandos principais para o primeiro deploy

Depois de preparar `/opt/lysimaco` e os arquivos externos:

```bash
sudo systemctl enable --now docker
cd /opt/lysimaco/app
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml build --pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
docker compose -f docker-compose.prod.yml ps
```

Validação pública:

```bash
curl -fsS https://lysimaco.com.br/api/health
curl -fsS https://lysimaco.com.br/api/ready
```

Logs:

```bash
docker compose -f docker-compose.prod.yml logs --tail=200 \
  mysql backend frontend cloudflared
```

Rollback:

```bash
PRODUCTION_APP_DIR=/opt/lysimaco/app \
  bash deploy/rollback.sh <SHA_ANTERIOR>
```

---

## 19. Conclusão

A base técnica necessária para hospedar o sistema web no servidor da escola foi
implementada e validada localmente. O sistema agora possui separação de
containers, proxy interno, banco persistente, healthchecks, shutdown seguro,
deploy remoto, rollback e documentação operacional.

A adaptação não deve ser considerada liberada para acesso público até a
conclusão das pendências do servidor real e o tratamento dos advisories npm.

A automação desktop permaneceu fora do escopo e fora das imagens, conforme
solicitado.
