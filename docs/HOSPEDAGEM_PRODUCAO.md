# Hospedagem em producao — Lysimaco Digital

## Arquitetura adotada

```text
Navegador HTTPS
  -> Cloudflare Tunnel
    -> frontend Nginx:80
      -> arquivos React
      -> /api/* -> backend Node:3000
        -> MySQL:3306
```

Somente o Tunnel inicia conexoes com a Cloudflare. O Compose nao publica
`ports` para frontend, backend ou MySQL. O MySQL fica em uma rede interna e usa
o volume nomeado `mysql_data`. O backend tambem participa da rede `app`, que
mantem a saida necessaria para SMTP sem expor sua porta no host.

A pasta `lysimaco-automacao-app/` e um aplicativo desktop separado. Ela esta no
`.dockerignore`, nao e copiada por nenhum Dockerfile e nao faz parte do Compose.

## Arquivos e diretorios no Ubuntu

```text
/opt/lysimaco/app                  clone do repositorio
/opt/lysimaco/env/backend.env      segredos e configuracao do backend
/opt/lysimaco/env/mysql.env        credenciais de inicializacao do MySQL
/opt/lysimaco/cloudflare/config.yml
/opt/lysimaco/cloudflare/<TUNNEL_ID>.json
/opt/lysimaco/state                lock e SHAs do deploy
/opt/lysimaco/backups/mysql        backups fora do volume principal
```

Recomendacao de permissoes:

```bash
sudo install -d -m 750 -o deploy -g deploy /opt/lysimaco/{app,state}
sudo install -d -m 750 -o root -g deploy /opt/lysimaco/{env,cloudflare,backups/mysql}
sudo chmod 600 /opt/lysimaco/env/*.env /opt/lysimaco/cloudflare/*.json
```

## Ambiente

Use `.env.production.example` somente como lista de variaveis. Separe os dois
arquivos reais:

- `backend.env`: `NODE_ENV`, `PORT`, `DB_*`, URLs, CORS, proxy, cookies, JWT,
  SMTP, retencao e tokens das maquinas;
- `mysql.env`: `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` e
  `MYSQL_ROOT_PASSWORD`.

`DB_USER` deve corresponder a `MYSQL_USER`, e `DB_PASSWORD` a
`MYSQL_PASSWORD`. A aplicacao nunca usa root. Gere segredos no servidor, por
exemplo com `openssl rand -base64 48`, e nao os envie ao GitHub.

Valores obrigatorios deste ambiente:

```env
NODE_ENV=production
PORT=3000
DB_HOST=mysql
DB_PORT=3306
ALLOWED_ORIGINS=https://lysimaco.com.br,https://www.lysimaco.com.br
FRONTEND_URL=https://lysimaco.com.br
PUBLIC_FRONTEND_URL=https://lysimaco.com.br
TRUST_PROXY=1
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
AUTH_DEV_BYPASS=false
DEV_LOGIN_ENABLED=false
```

O frontend e compilado com `VITE_API_URL=/api`. Nenhum segredo pode usar o
prefixo `VITE_`, pois valores Vite entram no bundle publico.

## Cloudflare Tunnel

1. Adicione `lysimaco.com.br` a uma conta Cloudflare e confirme os nameservers.
2. Crie um Tunnel nomeado no painel Zero Trust ou com `cloudflared tunnel
   create` em uma estacao administrativa.
3. Cadastre os hostnames `lysimaco.com.br` e `www.lysimaco.com.br` no Tunnel.
4. Copie o JSON real e um `config.yml` baseado em
   `deploy/cloudflare/config.yml.example` para o servidor.
5. Ative HTTPS e redirecionamento HTTP->HTTPS na Cloudflare. O TLS publico
   termina na Cloudflare; o trecho privado Tunnel->Nginx usa HTTP dentro da rede
   Docker.

O Nginx redireciona `www` para o dominio canonico e repassa `Host`, IP e
`X-Forwarded-Proto`. Atualizar uma rota React diretamente usa fallback para
`index.html`; arquivos ocultos sao bloqueados.

## Subida e reinicio automatico

```bash
sudo systemctl enable --now docker
cd /opt/lysimaco/app
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Todos os servicos usam `restart: unless-stopped`. MySQL, backend e frontend tem
healthchecks, e as dependencias aguardam `service_healthy`. Depois de um teste
de reboot:

```bash
sudo reboot
cd /opt/lysimaco/app
docker compose -f docker-compose.prod.yml ps
curl -fsS https://lysimaco.com.br/api/health
curl -fsS https://lysimaco.com.br/api/ready
```

## Deploy automatico

O fluxo e `push main -> testes GitHub Actions -> SSH -> deploy/deploy.sh`. Os
containers nao recebem Git, chave SSH nem `/var/run/docker.sock`.

Configure os secrets listados em `deploy/README.md`. Proteja a branch `main`,
restrinja o environment `production` e registre em
`PRODUCTION_KNOWN_HOSTS` a chave do servidor conferida por um canal confiavel.
O servidor precisa de uma deploy key apenas de leitura para `git fetch`.

O script salva o SHA anterior antes de `git reset --hard origin/main`; essa
operacao atinge somente `/opt/lysimaco/app`. Os ambientes, credenciais e dados
ficam fora da arvore Git. Falha de build, subida ou healthcheck chama rollback.

## SSH seguro

1. Crie usuarios separados para administracao e deploy; nao use root.
2. Teste acesso por chave em uma segunda sessao antes de desligar senhas.
3. Depois do teste, use `PermitRootLogin no`, `PasswordAuthentication no` e
   `PubkeyAuthentication yes`.
4. Restrinja UFW e prefira Tailscale, WireGuard ou Cloudflare Access para SSH.
5. Se o deploy precisar executar Docker, avalie um grupo Docker dedicado ou
   regras `sudoers` limitadas; participar do grupo Docker equivale a privilegio
   administrativo e nao deve ser concedido a contas comuns.
6. Nao exponha 3306, 3000, painel Docker ou Docker socket.

Exemplo basico de firewall quando SSH direto for inevitavel:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <REDE_ADMINISTRATIVA> to any port 22 proto tcp
sudo ufw enable
```

## Backup e migrations

Agende `mysqldump` autenticado por arquivo protegido ou Docker secret, comprima
e grave em `/opt/lysimaco/backups/mysql`. Mantenha retencao, uma copia fora do
servidor e testes regulares de restauracao.

Migrations continuam versionadas em `backend/src/database/migrations`. O deploy
nao as executa automaticamente: antes de uma mudanca de schema, produza backup,
avalie compatibilidade com a versao anterior, aplique a migration explicitamente
e valide o rollback. Nunca use `docker volume prune` neste host.

## Validacao de aceite no servidor

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 backend frontend mysql cloudflared
curl -i https://lysimaco.com.br/api/health
curl -i https://lysimaco.com.br/api/ready
curl -i -H 'Origin: https://lysimaco.com.br' https://lysimaco.com.br/api/health
curl -i -H 'Origin: https://externo.example' https://lysimaco.com.br/api/health
```

Tambem valide login/logout, CSRF, cookies `HttpOnly`/`Secure`/`SameSite=Lax`,
acesso direto a cada rota React, recuperacao de senha, perfis de administrador,
pedagoga e professor, persistencia apos recriar containers e rollback simulado.
