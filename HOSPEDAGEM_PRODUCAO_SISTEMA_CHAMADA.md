# Plano de Hospedagem em Produção — Sistema de Gestão de Chamadas Escolares

## 1. Objetivo

Este documento descreve como o **Sistema de Gestão de Chamadas Escolares** será hospedado em produção e quais adaptações precisam ser realizadas no repositório para que o sistema funcione corretamente nesse ambiente.

A hospedagem será feita em um **servidor próprio com Ubuntu Server**, instalado fisicamente em uma escola. A aplicação será executada com Docker e ficará disponível na internet por meio de um **Cloudflare Tunnel**.

Domínios públicos:

- `https://lysimaco.com.br`
- `https://www.lysimaco.com.br`

## 2. Escopo da alteração

O repositório atualmente também contém os arquivos da automação de envio de mensagens.

Essa automação será futuramente transformada em um aplicativo desktop local e **não faz parte desta hospedagem web**.

Durante esta alteração, o Codex deve:

- ignorar completamente a pasta da automação;
- não modificar, mover, excluir ou refatorar arquivos da automação;
- não incluir a automação nas imagens Docker;
- adicionar a pasta da automação ao `.dockerignore`, caso o contexto de build possa incluí-la;
- trabalhar somente no frontend, backend, banco, infraestrutura Docker e arquivos de implantação do sistema web.

## 3. Arquitetura final

A aplicação deverá ter os seguintes serviços:

```text
Internet
   |
Cloudflare
   |
Cloudflare Tunnel
   |
Frontend/Nginx
   |-- arquivos React/Vite
   |-- /api/* -> Backend
   |
Backend Node/Express
   |
MySQL
```

Contêineres principais:

1. `frontend`
   - compila e publica o frontend React/Vite;
   - utiliza Nginx para servir os arquivos estáticos;
   - redireciona as rotas `/api` para o backend;
   - suporta o roteamento SPA do React.

2. `backend`
   - executa a API Node.js/Express;
   - recebe somente conexões da rede interna do Docker;
   - não deve publicar sua porta diretamente na internet;
   - conecta-se ao MySQL pela rede interna do Docker.

3. `mysql`
   - armazena os dados do sistema;
   - utiliza volume persistente;
   - não publica a porta `3306` na internet;
   - só aceita conexões dos serviços internos autorizados.

Serviço de infraestrutura:

4. `cloudflared`
   - mantém o Cloudflare Tunnel;
   - encaminha os dois domínios para o Nginx do frontend;
   - não deve armazenar credenciais dentro do repositório.

O mecanismo de deploy automático deve ficar separado dos contêineres da aplicação.

## 4. Redes Docker

Criar redes Docker separadas sempre que possível:

- `web-network`: comunicação entre Cloudflare Tunnel e frontend;
- `app-network`: comunicação entre frontend, backend e MySQL;
- a rede do banco deve ser interna e não deve publicar portas no host.

Exemplo conceitual:

```yaml
networks:
  web-network:
  app-network:
    internal: true
```

O frontend pode participar das duas redes. O backend e o MySQL devem ficar somente na rede interna da aplicação.

## 5. Persistência do MySQL

O MySQL deve utilizar um volume nomeado:

```yaml
volumes:
  mysql_data:
```

Os dados não podem ser armazenados apenas dentro da camada descartável do contêiner.

Requisitos:

- definir `MYSQL_DATABASE`;
- definir usuário exclusivo para a aplicação;
- não utilizar o usuário `root` no backend;
- manter a senha do root e a senha da aplicação somente no servidor;
- configurar charset `utf8mb4`;
- configurar healthcheck;
- realizar backup periódico fora do volume principal.

Exemplo de conexão interna:

```env
DB_HOST=mysql
DB_PORT=3306
DB_NAME=sistema_chamadas
DB_USER=sistema_chamadas_app
DB_PASSWORD=VALOR_DEFINIDO_SOMENTE_NO_SERVIDOR
```

## 6. Variáveis de ambiente e segredos

As variáveis de produção devem ser criadas diretamente no servidor.

Local sugerido:

```text
/opt/lysimaco/env/backend.env
/opt/lysimaco/env/mysql.env
/opt/lysimaco/env/cloudflared.env
```

Permissões recomendadas:

```bash
sudo chown root:root /opt/lysimaco/env/*.env
sudo chmod 600 /opt/lysimaco/env/*.env
```

Os arquivos reais de ambiente:

- não podem ser enviados ao GitHub;
- não podem ser copiados para imagens Docker;
- não podem aparecer em logs;
- não podem ser retornados por rotas da API;
- não podem ser entregues ao navegador;
- não podem ser incluídos no frontend durante o build.

O repositório deve conter somente arquivos de exemplo:

```text
.env.example
.env.production.example
```

Esses arquivos devem usar valores fictícios e explicar cada variável.

Exemplo de variáveis do backend:

```env
NODE_ENV=production
PORT=3000

DB_HOST=mysql
DB_PORT=3306
DB_NAME=sistema_chamadas
DB_USER=sistema_chamadas_app
DB_PASSWORD=ALTERAR_NO_SERVIDOR

ALLOWED_ORIGINS=https://lysimaco.com.br,https://www.lysimaco.com.br

SESSION_SECRET=ALTERAR_NO_SERVIDOR
JWT_SECRET=ALTERAR_NO_SERVIDOR
CSRF_SECRET=ALTERAR_NO_SERVIDOR

COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
TRUST_PROXY=1
```

Manter somente as variáveis realmente utilizadas pelo projeto. Não criar segredos duplicados sem necessidade.

## 7. Domínios e roteamento

Os domínios públicos serão:

```text
https://lysimaco.com.br
https://www.lysimaco.com.br
```

Recomendação:

- utilizar `https://lysimaco.com.br` como domínio canônico;
- redirecionar `https://www.lysimaco.com.br` para `https://lysimaco.com.br`;
- aceitar temporariamente os dois domínios no CORS;
- não utilizar URLs de `localhost` no build de produção.

A API deve ser disponibilizada pelo mesmo domínio usando o prefixo:

```text
https://lysimaco.com.br/api
```

Exemplos:

```text
https://lysimaco.com.br/api/auth/login
https://lysimaco.com.br/api/users
https://lysimaco.com.br/api/classes
https://lysimaco.com.br/api/attendance
```

Não é necessário criar um subdomínio público separado para o backend.

O frontend deve utilizar uma URL relativa:

```env
VITE_API_URL=/api
```

ou uma configuração equivalente.

Isso evita:

- exposição direta da porta do backend;
- dependência de endereços internos;
- problemas desnecessários de CORS;
- necessidade de alterar o frontend ao mudar o endereço interno do backend.

## 8. Configuração do Nginx

O Nginx do frontend deverá:

- servir o build do React/Vite;
- aplicar fallback para `index.html`;
- encaminhar `/api/` para o backend;
- encaminhar cabeçalhos de proxy corretamente;
- definir limites adequados de upload, caso o sistema envie arquivos;
- não expor arquivos ocultos, `.env`, mapas de código ou arquivos internos;
- retornar cabeçalhos básicos de segurança.

Exemplo conceitual:

```nginx
server {
    listen 80;
    server_name lysimaco.com.br;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://backend:3000/api/;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host $host;

        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~ /\. {
        deny all;
    }
}

server {
    listen 80;
    server_name www.lysimaco.com.br;
    return 301 https://lysimaco.com.br$request_uri;
}
```

Como o HTTPS termina no Cloudflare, o Nginx pode receber HTTP na rede Docker. O backend deve respeitar o cabeçalho `X-Forwarded-Proto`.

## 9. Adaptações necessárias no backend

### 9.1 Prefixo da API

Padronizar as rotas públicas do backend com `/api`.

Exemplo:

```javascript
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/attendance', attendanceRoutes);
```

Se o projeto já utiliza outro padrão, adaptar sem quebrar os endpoints existentes. Quando necessário, manter compatibilidade temporária e documentar a migração.

### 9.2 CORS

Configurar uma allowlist exata.

Origens permitidas em produção:

```text
https://lysimaco.com.br
https://www.lysimaco.com.br
```

Não utilizar:

```javascript
origin: '*'
```

quando existirem cookies, sessões ou credenciais.

Exemplo conceitual:

```javascript
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origem não permitida pelo CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
}));
```

Em desenvolvimento, permitir somente as origens locais explicitamente configuradas.

### 9.3 Proxy confiável

Como o backend ficará atrás do Nginx e do Cloudflare:

```javascript
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
```

Verificar a configuração real do framework para não confiar em proxies arbitrários.

### 9.4 Cookies de produção

Cookies de autenticação:

- `HttpOnly: true`;
- `Secure: true` em produção;
- `SameSite: Lax`, salvo necessidade real de outro valor;
- não armazenar JWT no `localStorage` ou `sessionStorage`;
- não definir `Domain=.lysimaco.com.br` sem necessidade;
- manter tempo de expiração adequado;
- limpar cookies usando exatamente as mesmas opções usadas na criação.

Exemplo conceitual:

```javascript
const isProduction = process.env.NODE_ENV === 'production';

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/'
};
```

### 9.5 CSRF

Se a autenticação utilizar cookies, manter ou implementar proteção CSRF adequada.

O token CSRF pode ser acessível ao frontend quando isso for necessário, mas não pode autenticar o usuário sozinho.

### 9.6 Banco de dados

O backend deve usar as variáveis:

```text
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD
```

Não utilizar:

- `localhost` para acessar o MySQL dentro do Docker;
- credenciais hardcoded;
- usuário root;
- reconexão infinita sem intervalo;
- logs contendo senhas ou strings completas de conexão.

### 9.7 Healthcheck

Criar rotas sem dados sensíveis:

```text
GET /api/health
GET /api/ready
```

Sugestão:

- `/api/health`: confirma que o processo está ativo;
- `/api/ready`: confirma que o backend consegue acessar dependências essenciais, como o banco.

Não retornar:

- variáveis de ambiente;
- senhas;
- caminhos internos;
- stack traces;
- versões detalhadas desnecessárias;
- dados de usuários.

### 9.8 Encerramento controlado

Implementar encerramento seguro para `SIGTERM` e `SIGINT`:

- parar de aceitar novas conexões;
- finalizar requisições em andamento;
- fechar pool do banco;
- encerrar o processo com código adequado.

Isso é necessário para atualizações e reinícios dos contêineres.

### 9.9 Logs

Em produção:

- não registrar senhas;
- não registrar tokens;
- não registrar cookies completos;
- não registrar documentos pessoais;
- não registrar corpos completos de requisições sensíveis;
- incluir data, nível, rota e identificador da requisição;
- permitir consulta por `docker compose logs`.

## 10. Adaptações necessárias no frontend

O frontend deve:

- remover URLs hardcoded de `localhost`;
- utilizar `/api` em produção;
- manter uma configuração local separada para desenvolvimento;
- não receber segredos no build;
- não salvar JWT ou dados sensíveis em `localStorage` ou `sessionStorage`;
- tratar erros 401 e 403 corretamente;
- funcionar ao atualizar páginas internas diretamente;
- funcionar nos dois domínios enquanto o redirecionamento é aplicado;
- gerar build estático para Nginx.

Exemplo:

```javascript
const API_URL = import.meta.env.VITE_API_URL || '/api';
```

O valor de produção deverá ser:

```env
VITE_API_URL=/api
```

## 11. Dockerfiles

Criar Dockerfiles separados.

### Backend

Requisitos:

- build em múltiplos estágios quando necessário;
- imagem Node estável e leve;
- instalar somente dependências de produção na imagem final;
- executar como usuário não root;
- copiar somente os arquivos necessários;
- possuir healthcheck;
- não copiar `.env`;
- não copiar a pasta da automação;
- expor somente a porta interna do backend.

### Frontend

Requisitos:

- estágio de build com Node;
- estágio final com Nginx;
- copiar somente `dist`;
- configuração própria do Nginx;
- não incluir código-fonte ou segredos desnecessários na imagem final;
- não incluir a pasta da automação.

## 12. `.dockerignore`

Criar `.dockerignore` na raiz e, se necessário, em cada aplicação.

Incluir pelo menos:

```text
.git
.github
node_modules
dist
build
coverage
*.log
.env
.env.*
!.env.example
!.env.production.example
automacao
automation
desktop-automation
```

O Codex deve identificar o nome real da pasta da automação e adicionar o caminho correto, sem apagar a pasta.

## 13. Docker Compose de produção

Criar um arquivo, por exemplo:

```text
docker-compose.prod.yml
```

Serviços esperados:

```yaml
services:
  mysql:
    image: mysql:8
    restart: unless-stopped
    env_file:
      - /opt/lysimaco/env/mysql.env
    volumes:
      - mysql_data:/var/lib/mysql
    networks:
      - app-network
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h localhost -u root -p$$MYSQL_ROOT_PASSWORD"]
      interval: 10s
      timeout: 5s
      retries: 10

  backend:
    build:
      context: .
      dockerfile: caminho/para/backend/Dockerfile
    restart: unless-stopped
    env_file:
      - /opt/lysimaco/env/backend.env
    depends_on:
      mysql:
        condition: service_healthy
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 20s
      timeout: 5s
      retries: 5

  frontend:
    build:
      context: .
      dockerfile: caminho/para/frontend/Dockerfile
    restart: unless-stopped
    depends_on:
      backend:
        condition: service_healthy
    networks:
      - web-network
      - app-network

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    volumes:
      - /opt/lysimaco/cloudflare:/etc/cloudflared:ro
    networks:
      - web-network
    depends_on:
      frontend:
        condition: service_started

volumes:
  mysql_data:

networks:
  web-network:
  app-network:
    internal: true
```

O Codex deve ajustar caminhos, comandos e healthchecks de acordo com a estrutura real do repositório.

Evitar a tag `latest` nas imagens da aplicação. Para imagens de terceiros, preferir versões estáveis fixadas e atualizar conscientemente.

Não publicar:

```yaml
ports:
  - "3306:3306"
```

Não publicar diretamente a porta do backend.

## 14. Cloudflare Tunnel

Arquivos do túnel no servidor:

```text
/opt/lysimaco/cloudflare/config.yml
/opt/lysimaco/cloudflare/<TUNNEL_ID>.json
```

Exemplo conceitual:

```yaml
tunnel: ID_DO_TUNNEL
credentials-file: /etc/cloudflared/ID_DO_TUNNEL.json

ingress:
  - hostname: lysimaco.com.br
    service: http://frontend:80

  - hostname: www.lysimaco.com.br
    service: http://frontend:80

  - service: http_status:404
```

As credenciais reais:

- não podem entrar no GitHub;
- devem ficar somente no servidor;
- devem ser montadas como somente leitura;
- devem possuir permissões restritas.

Configurar no Cloudflare:

- DNS dos dois domínios apontando para o Tunnel;
- SSL/TLS em modo seguro;
- Always Use HTTPS;
- proteção contra requisições maliciosas;
- limites de acesso quando necessário.

## 15. Inicialização automática com o servidor

No Ubuntu Server:

```bash
sudo systemctl enable docker
sudo systemctl start docker
```

Os serviços no Compose devem usar:

```yaml
restart: unless-stopped
```

Após reiniciar o servidor, Docker deve iniciar e restaurar:

- MySQL;
- backend;
- frontend;
- Cloudflare Tunnel.

Também criar uma verificação documentada:

```bash
sudo reboot
docker compose -f docker-compose.prod.yml ps
```

A ordem de inicialização deve utilizar healthchecks e `depends_on`, sem depender apenas de atrasos fixos.

## 16. Deploy remoto automático

### 16.1 Regra principal

Quando houver um commit novo na branch `main`, o servidor deve atualizar a aplicação sem que seja necessário ir fisicamente à escola.

### 16.2 Arquitetura recomendada

Não realizar `git clone` dentro dos contêineres `frontend` ou `backend`.

Esses contêineres devem ser imutáveis e descartáveis.

Fluxo recomendado:

```text
Push na main
   |
GitHub Actions
   |
Conexão SSH segura com o servidor
   |
Executa /opt/lysimaco/scripts/deploy.sh
   |
git fetch/reset da cópia no host
   |
docker compose build
   |
docker compose up -d
   |
healthcheck
```

A cópia do repositório pode ficar em:

```text
/opt/lysimaco/app
```

O servidor pode utilizar uma deploy key de leitura para buscar o repositório privado.

### 16.3 Script de deploy

Criar:

```text
deploy/deploy.sh
```

O script deve:

1. usar `set -Eeuo pipefail`;
2. criar lock para impedir dois deploys simultâneos;
3. registrar início, commit e resultado;
4. executar `git fetch origin main`;
5. validar que o commit pertence à branch `main`;
6. executar `git reset --hard origin/main`;
7. não apagar os arquivos de ambiente externos;
8. executar build das novas imagens;
9. iniciar os serviços com `docker compose up -d --remove-orphans`;
10. aguardar healthchecks;
11. falhar de forma clara se algum serviço ficar unhealthy;
12. preservar o volume do MySQL;
13. não executar `docker volume prune`;
14. remover somente imagens antigas sem uso, com cuidado;
15. permitir rollback para o commit anterior quando o deploy falhar.

O deploy não deve executar migrations destrutivas automaticamente sem confirmação ou estratégia de rollback.

### 16.4 GitHub Actions

Criar workflow:

```text
.github/workflows/deploy-production.yml
```

Disparo:

```yaml
on:
  push:
    branches:
      - main
```

Utilizar secrets do GitHub, por exemplo:

```text
PRODUCTION_HOST
PRODUCTION_PORT
PRODUCTION_USER
PRODUCTION_SSH_KEY
PRODUCTION_APP_DIR
```

Não colocar IP, senha ou chave privada diretamente no workflow.

Recomendações:

- proteger a branch `main`;
- exigir testes antes do job de deploy;
- usar autenticação SSH por chave;
- validar a chave do host;
- limitar o usuário de deploy;
- permitir que esse usuário execute somente o script necessário;
- evitar acesso root direto;
- impedir deploy concorrente;
- registrar o SHA implantado.

### 16.5 Alternativa: servidor observando o GitHub

Caso seja obrigatório que o próprio servidor verifique alterações, utilizar um serviço isolado no host ou um timer do systemd para consultar o commit remoto.

Não dar ao backend ou frontend acesso a:

```text
/var/run/docker.sock
```

Montar o Docker socket em um contêiner equivale, na prática, a conceder controle administrativo do servidor. Por isso, o método GitHub Actions + SSH é preferível.

## 17. Controle remoto por SSH

O servidor deverá ser administrado remotamente por SSH.

Requisitos mínimos:

- autenticação por chave;
- desativar login SSH do root;
- desativar autenticação por senha depois de validar as chaves;
- usuário administrativo separado;
- usuário de deploy com permissões limitadas;
- firewall UFW;
- Fail2ban ou mecanismo equivalente;
- atualizações de segurança;
- não compartilhar a chave privada;
- proteger backups da chave.

Configuração conceitual:

```text
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

A porta SSH não precisa estar vinculada aos domínios públicos do sistema.

Opções seguras:

1. VPN privada, como Tailscale ou WireGuard;
2. Cloudflare Access para SSH;
3. porta SSH pública com chave, firewall e proteção adicional, somente quando as opções privadas não forem possíveis.

Não expor o MySQL, backend ou painel Docker para a internet.

## 18. Atualizações do banco

Se o projeto utilizar migrations:

- executar migrations antes de considerar o deploy concluído;
- manter migrations versionadas;
- nunca editar uma migration já aplicada em produção;
- evitar mudanças destrutivas;
- criar backup antes de alterações críticas;
- permitir que uma versão antiga e nova convivam durante atualizações quando possível;
- registrar qual migration foi aplicada.

## 19. Backups

Criar documentação para backup periódico do MySQL.

O backup deve:

- ser salvo fora do volume principal;
- possuir retenção;
- ser criptografado quando enviado para outro local;
- ser testado por restauração;
- não ser enviado ao GitHub;
- não ficar acessível pelo Nginx.

Exemplo de diretório:

```text
/opt/lysimaco/backups/mysql
```

## 20. Segurança adicional

Implementar ou verificar:

- rate limit em login e recuperação de senha;
- limitação do tamanho do corpo das requisições;
- headers de segurança;
- validação de entrada;
- tratamento centralizado de erros;
- mensagens de erro sem stack trace em produção;
- senhas armazenadas somente com hash seguro;
- nenhum dado sensível no frontend;
- nenhuma rota administrativa sem autenticação e autorização;
- cookies seguros;
- CSRF quando necessário;
- CORS com allowlist;
- logs sem dados sensíveis;
- banco inacessível pela internet.

## 21. Estrutura sugerida no repositório

Adaptar aos nomes reais:

```text
/
├── backend/
│   ├── Dockerfile
│   └── ...
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── ...
├── deploy/
│   ├── deploy.sh
│   ├── rollback.sh
│   └── README.md
├── .github/
│   └── workflows/
│       └── deploy-production.yml
├── docker-compose.prod.yml
├── .dockerignore
├── .env.production.example
└── docs/
    └── HOSPEDAGEM_PRODUCAO.md
```

A pasta real da automação deve permanecer intacta e fora dos contextos Docker.

## 22. Testes obrigatórios

Antes de concluir, testar:

### Build

- build do backend;
- build do frontend;
- criação das imagens Docker;
- inicialização do Compose.

### Rede

- frontend acessa backend por `/api`;
- backend acessa MySQL pelo nome do serviço;
- MySQL não possui porta pública;
- backend não possui porta pública;
- Cloudflare Tunnel alcança somente o frontend.

### Domínios

- `https://lysimaco.com.br`;
- `https://www.lysimaco.com.br`;
- redirecionamento para o domínio canônico;
- navegação direta em rotas internas do React;
- requisições da API.

### CORS

Aceitar:

```text
https://lysimaco.com.br
https://www.lysimaco.com.br
```

Bloquear origem externa não autorizada.

### Autenticação

- login;
- logout;
- renovação ou expiração da sessão;
- cookies `HttpOnly`;
- cookies `Secure` em produção;
- proteção CSRF, quando aplicável;
- nenhuma credencial em localStorage/sessionStorage.

### Reinício

- reiniciar um contêiner;
- reiniciar o Docker;
- reiniciar o Ubuntu Server;
- confirmar restauração automática da aplicação.

### Deploy

- push de teste na `main`;
- execução única do deploy;
- manutenção do volume MySQL;
- manutenção dos arquivos `.env` externos;
- healthcheck final;
- rollback em falha simulada.

### Regressão

- fluxo do administrador;
- fluxo da pedagoga;
- fluxo do professor;
- criação e edição de usuários;
- criação de turmas e alunos;
- realização, edição e confirmação de chamadas;
- relatórios;
- recuperação de senha;
- permissões por perfil.

### Automação

Confirmar que:

- nenhum arquivo da automação foi modificado;
- a automação não está presente nas imagens Docker;
- o sistema web continua se comunicando com a futura automação somente pelos contratos de API já definidos, quando aplicável.

## 23. Critérios de aceite

A adaptação será considerada concluída quando:

- o frontend, backend e MySQL funcionarem em contêineres separados;
- os dois domínios funcionarem via Cloudflare Tunnel;
- a API estiver acessível em `/api`;
- o CORS aceitar somente as origens autorizadas;
- os segredos existirem somente no servidor;
- o MySQL não estiver exposto;
- o backend não estiver exposto diretamente;
- o sistema reiniciar automaticamente após reboot;
- o deploy na `main` puder ser realizado remotamente;
- os healthchecks confirmarem o sucesso do deploy;
- existir rollback documentado;
- a pasta da automação permanecer intacta;
- os fluxos atuais do sistema continuarem funcionando.

## 24. O que não deve ser feito

- Não modificar a pasta da automação.
- Não publicar o MySQL.
- Não publicar diretamente o backend.
- Não colocar `.env` no GitHub.
- Não colocar segredos em variáveis `VITE_*`.
- Não usar CORS com `*` e credenciais.
- Não salvar JWT em localStorage ou sessionStorage.
- Não montar o Docker socket no backend ou frontend.
- Não executar a aplicação como root sem necessidade.
- Não utilizar `docker volume prune` no deploy.
- Não apagar o volume do banco durante atualizações.
- Não aplicar migrations destrutivas sem proteção.
- Não alterar regras funcionais do sistema sem necessidade.
