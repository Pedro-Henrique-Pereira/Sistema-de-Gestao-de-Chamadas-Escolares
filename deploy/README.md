# Operacao de producao

Os scripts deste diretorio atualizam somente a copia do repositorio em
`/opt/lysimaco/app`. Segredos, credenciais do Tunnel e o volume MySQL ficam fora
desse diretorio e nao sao removidos pelo deploy.

## Primeiro preparo

1. Instale Docker Engine, o plugin Docker Compose, Git e `flock` no Ubuntu.
2. Clone a branch `main` em `/opt/lysimaco/app` com uma deploy key de leitura.
3. Crie `/opt/lysimaco/env/backend.env` e `/opt/lysimaco/env/mysql.env` a partir
   de `.env.production.example`, com permissao `600`.
4. Copie `deploy/cloudflare/config.yml.example` para
   `/opt/lysimaco/cloudflare/config.yml`, preencha o ID real e coloque o JSON de
   credenciais no mesmo diretorio com permissao `600`.
5. Crie `/opt/lysimaco/state` e entregue `app`, `env`, `cloudflare` e `state` ao
   usuario de deploy conforme a necessidade minima de leitura/escrita.

Inicializacao inicial:

```bash
cd /opt/lysimaco/app
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

## Deploy

O workflow da `main` executa testes e abre SSH validado pelo secret
`PRODUCTION_KNOWN_HOSTS`. No host ele executa:

```bash
PRODUCTION_APP_DIR=/opt/lysimaco/app bash deploy/deploy.sh <SHA_DA_MAIN>
```

O script usa lock, busca `origin/main`, exige o SHA esperado, reconstrui as
imagens, sobe com `--remove-orphans` e aguarda MySQL, backend e frontend ficarem
saudaveis. Nenhuma migration e executada implicitamente.

## Rollback manual

```bash
PRODUCTION_APP_DIR=/opt/lysimaco/app bash deploy/rollback.sh <SHA_ANTERIOR>
```

Sem argumento, o script usa `/opt/lysimaco/state/previous.sha`. O rollback
reconstroi a aplicacao, mas preserva o volume `lysimaco_mysql_data`, os `.env`
externos e as credenciais do Cloudflare. Uma migration incompativel deve ter
plano proprio; o script nao mascara nem desfaz alteracoes de schema.

## Secrets do GitHub

- `PRODUCTION_HOST`
- `PRODUCTION_PORT`
- `PRODUCTION_USER`
- `PRODUCTION_SSH_KEY`
- `PRODUCTION_APP_DIR`
- `PRODUCTION_KNOWN_HOSTS` (linha confiavel de `known_hosts`, conferida fora do
  proprio canal que sera autenticado)

Nao use `ssh-keyscan` dentro do workflow como unica validacao do primeiro
contato: isso aceitaria a chave apresentada durante um ataque no momento do
deploy.
