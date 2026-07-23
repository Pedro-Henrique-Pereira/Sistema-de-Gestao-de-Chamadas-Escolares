# Relatorio da adaptacao para producao — 2026-07-22

## Resultado

O sistema web foi preparado para Ubuntu Server com Docker Compose, Cloudflare
Tunnel e os dominios `lysimaco.com.br` e `www.lysimaco.com.br`.

Foram adotados containers separados para MySQL, backend, frontend/Nginx e
cloudflared. Nenhum servico publica portas no host. O acesso publico entra pelo
Tunnel no frontend, e somente o Nginx encaminha `/api/*` ao backend.

## Alteracoes de aplicacao

- CORS de producao usa `ALLOWED_ORIGINS` e nao inclui mais a URL Vercel fixa.
- `TRUST_PROXY` e aceito, com compatibilidade para `TRUST_PROXY_HOPS`.
- `GET /api/health` verifica o processo e `GET /api/ready` verifica o MySQL sem
  expor detalhes do erro.
- SIGTERM/SIGINT param o servidor HTTP e fecham o pool MySQL.
- cookies permanecem HttpOnly/Secure e usam `SameSite=Lax` por padrao em
  producao, configuravel por ambiente.
- o frontend aceita `VITE_API_URL=/api` sem gerar `/api/api` e usa `/api` como
  padrao same-origin.

## Infraestrutura criada

- `.dockerignore` e `.env.production.example`;
- `backend/Dockerfile` e `frontend/Dockerfile`;
- `frontend/nginx.conf`;
- `docker-compose.prod.yml`;
- `deploy/deploy.sh`, `deploy/rollback.sh` e `deploy/README.md`;
- `deploy/cloudflare/config.yml.example`;
- `.github/workflows/deploy-production.yml`;
- `docs/HOSPEDAGEM_PRODUCAO.md`.

## Validacoes executadas

- backend: 101 testes aprovados;
- frontend: 29 testes aprovados;
- build Vite aprovado;
- `node --check` aprovado nos novos modulos e no servidor;
- `docker compose config --quiet` aprovado;
- imagens backend e frontend construidas;
- scripts Bash validados com `bash -n` em container oficial;
- MySQL, backend e frontend ficaram `healthy` em Compose isolado;
- Nginx encaminhou `/api/health` ao backend;
- CORS real aceitou os dois dominios e bloqueou origem externa com HTTP 403;
- fallback SPA retornou `index.html` em rota interna;
- MySQL preservou um marcador depois de recriar o container;
- nenhum dos tres servicos publicou porta no host;
- `restart: unless-stopped` confirmado;
- backend voltou a `healthy` depois de reinicio;
- `lysimaco-automacao-app` nao apareceu nas imagens.

O ambiente temporario, seu volume de teste e suas imagens duplicadas foram
removidos depois da validacao. As imagens finais `lysimaco-backend` e
`lysimaco-frontend` permaneceram locais como evidencia do build.

## Riscos e etapas manuais

- Cloudflare, DNS, SSH, UFW, GitHub Secrets e arquivos `/opt/lysimaco/env/*`
  dependem do servidor real e nao foram alterados remotamente.
- Login/logout e os fluxos completos por perfil devem ser revalidados contra
  uma copia segura do schema/dados de producao antes da abertura publica.
- O build do backend informou 3 advisories npm (1 baixo e 2 altos). A arvore
  local aponta dependencias legadas transitivas principalmente sob `exceljs`,
  mas a consulta detalhada ao servico npm nao foi autorizada nesta execucao.
  Trate a analise e correcao desses advisories como bloqueio antes da abertura
  publica, sem aplicar `npm audit fix --force` automaticamente.
- Deploy e rollback foram validados em sintaxe; a simulacao por push na `main`
  deve ser feita em staging ou janela de manutencao depois de cadastrar os
  secrets e conferir a chave SSH do host.
- Migrations continuam deliberadamente manuais para nao mascarar falhas nem
  impedir rollback da aplicacao.

## Automacao desktop

A pasta `lysimaco-automacao-app/` ja possuia alteracoes locais antes deste
trabalho. Nenhum arquivo dessa pasta foi modificado por esta adaptacao. A pasta
foi apenas excluida do contexto Docker e permaneceu fora das imagens.
