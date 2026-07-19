# Sistema Integrado de Gestão de Chamadas e Automação Escolar

> **Desenvolvido por Pedro-Henrique-Pereira (PHtw) © 2026**

---

## 📚 Sobre o Projeto

O **Sistema Integrado de Gestão de Chamadas e Automação Escolar** é uma plataforma híbrida composta por:

* Aplicação Web (Frontend React)
* API Backend (Node.js + Express)
* Banco de Dados MySQL hospedado no Railway
* Automação Desktop Local (Python + Selenium)

O sistema foi projetado para modernizar o processo de controle de frequência escolar, reduzir tarefas manuais e automatizar a comunicação entre escola e responsáveis.

---

# 🎯 O Problema que Resolve

Antes da implantação deste sistema, o processo de gestão de frequência escolar apresentava diversos gargalos operacionais:

### Problemas Encontrados

* Professores realizavam chamadas manualmente.
* Pedagogas precisavam consultar diversas planilhas para identificar ausências.
* Administradores não possuíam visão consolidada dos dados da escola.
* Alunos atrasados eram identificados apenas horas depois.
* Comunicação com responsáveis dependia de processos manuais.
* Não existia monitoramento em tempo real.
* Grande consumo de tempo operacional da equipe pedagógica.

---

## Cenário Anterior

### Professor

* Preenchia listas manualmente.
* Entregava informações posteriormente.
* Necessidade de retrabalho.

### Pedagoga

* Conferência manual das faltas.
* Dificuldade para localizar responsáveis.
* Baixa rastreabilidade dos registros.

### Administração

* Falta de indicadores em tempo real.
* Relatórios demorados.
* Pouca capacidade de análise histórica.

---

## Como o Sistema Resolve

O projeto adota uma arquitetura híbrida:

### Camada Web

Responsável por:

* Registro de chamadas.
* Gestão escolar.
* Relatórios.
* Dashboard.
* Controle de usuários.

### Camada Desktop

Executada localmente na escola:

* Monitora solicitações pendentes.
* Processa filas de automação.
* Opera em segundo plano.
* Envia notificações automaticamente.
* Mantém logs locais para auditoria.

### Resultado

✅ Menos trabalho manual

✅ Maior velocidade operacional

✅ Comunicação automatizada

✅ Dados centralizados

✅ Monitoramento em tempo real

---

# 🚀 Objetivo do Sistema

Centralizar toda a gestão de frequência escolar em uma única plataforma integrada.

O sistema tem como objetivo:

* Controlar chamadas escolares.
* Monitorar atrasos em tempo real.
* Automatizar notificações.
* Auxiliar o trabalho pedagógico.
* Produzir relatórios analíticos.
* Reduzir consumo de recursos na infraestrutura Railway.
* Escalar para centenas de alunos sem perda significativa de desempenho.

---

# 👥 Principais Funcionalidades

---

## 🔴 Área do Administrador

### Dashboard Global

* Indicadores.
* Métricas diárias.
* Métricas semanais.
* Métricas mensais.
* Métricas anuais.

### Relatórios

* Frequência por período.
* Ausências.
* Justificativas.
* Atrasos.
* Exportação de dados.

### Gestão de Cadastros

* Usuários.
* Professores.
* Pedagogas.
* Turmas.
* Alunos.
* Responsáveis.

### Controle de Automação

* Monitoramento das filas.
* Controle de máquinas autorizadas.
* Restrições por perfil.

### Segurança

* RBAC (Controle por Perfil).
* Auditoria.
* Sessão única.
* Logout global.

---

## 🟡 Área das Pedagogas

### Painel Operacional

* Visualização rápida das chamadas.
* Gestão de justificativas.
* Histórico escolar.

### Painel de Alunos Atrasados

Implementado através de:

**Tab Toggle Integrado**

Botões:

* Painel Principal
* Painel de Atrasos

### Funcionalidades

* Atualização sob demanda.
* Cálculo automático do atraso.
* Tempo de atraso em minutos.
* Identificação visual rápida.
* Integração ao dashboard principal.

### Regra de Cálculo

O atraso é calculado utilizando:

* Horário da chamada registrada pelo professor.
* Horário efetivo de chegada do aluno.

Resultado:

```text
Tempo de Atraso = Hora de Chegada - Hora da Chamada
```

---

## 🟢 Automação Desktop (Python + Selenium)

### Execução em Segundo Plano

* Operação silenciosa.
* Não interfere no uso do computador.

### Watchdog Inteligente

Tempo de inatividade:

```text
01h30min
```

Funções:

* Detectar travamentos.
* Reiniciar processos.
* Manter estabilidade operacional.

### Inicialização Automática

Suporte para:

#### Windows

* Registro via Winreg.

#### Linux

* Autostart.
* Systemd (quando configurado).

### Sistema de Logs

* Logs em tempo real.
* Rotação automática.
* Limite de linhas na interface.
* Exportação para auditoria.

### Tratamento de Erros

* Alertas visuais.
* Registro detalhado.
* Stack Trace.
* Recuperação automática.

---

# 🏗️ Arquitetura do Projeto

```text
┌─────────────────────────┐
│      Frontend React     │
└────────────┬────────────┘
             │ HTTPS
             ▼
┌─────────────────────────┐
│   Backend Node.js API   │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│      MySQL Railway      │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Automação Desktop Local │
│ Python + Selenium       │
└─────────────────────────┘
```

---

## Camadas

### `/frontend`

Tecnologias:

* React
* Vite
* Tailwind CSS
* Axios

Responsável por:

* Interface do usuário.
* Dashboards.
* Relatórios.
* Gestão escolar.

---

### `/backend`

Tecnologias:

* Node.js
* Express
* MySQL

Responsável por:

* API REST.
* Regras de negócio.
* Autenticação.
* Controle de permissões.

---

### `/desktop-bot`

Tecnologias:

* Python
* Selenium
* CustomTkinter

Responsável por:

* Execução das automações.
* Processamento das filas.
* Integração com WhatsApp Web.

---


# 🛠️ Dependências e Tecnologias

## Frontend

| Tecnologia   | Finalidade       |
| ------------ | ---------------- |
| React        | Interface        |
| Vite         | Build            |
| Tailwind CSS | Estilização      |
| Axios        | Requisições HTTP |
| Lucide React | Ícones           |

---

## Backend

| Tecnologia         | Finalidade              |
| ------------------ | ----------------------- |
| Node.js            | Runtime                 |
| Express            | API                     |
| MySQL2             | Banco de Dados          |
| mysql2/promise     | Queries Assíncronas     |
| dotenv             | Variáveis de Ambiente   |
| JWT                | Autenticação            |
| bcrypt             | Hash de Senhas          |
| express-rate-limit | Proteção contra abuso   |
| Nodemailer         | Envio SMTP seguro       |
| trust proxy        | Compatibilidade Railway |

---

## Desktop

| Tecnologia           | Finalidade            |
| -------------------- | --------------------- |
| Python 3             | Runtime               |
| Selenium             | Automação             |
| CustomTkinter        | Interface             |
| Winreg               | Inicialização Windows |
| Watchdog Customizado | Monitoramento         |

---

# ⚙️ Instalação e Execução

## Frontend

```bash
cd frontend

npm install

npm run dev
```

---

## Backend

```bash
cd backend

npm install
```

Criar arquivo:

```bash
config.env
```

Executar:

```bash
npm start
```

ou

```bash
npm run dev
```

---

## Automação Desktop

Instalar dependências:

```bash
cd desktop-bot

pip install -r requirements.txt
```

Executar:

```bash
python main.py
```

---

# 🔒 Segurança

O sistema implementa:

* JWT HttpOnly
* Sessão Única
* Logout Global
* RBAC
* Auditoria
* Hash BCrypt
* CSRF Protection
* Rate Limiting
* Trust Proxy configurado para Railway
* Controle de acesso por perfil
* Recuperação de senha com token temporário de uso único

---

# 📈 Otimizações Recentes

### Backend

* Paginação SQL real.
* LIMIT/OFFSET.
* Carregamento sob demanda.
* Redução de consumo RAM.
* Queries otimizadas.

### Frontend

* Cache via SessionStorage.
* Lazy Loading.
* Componentes sob demanda.

### Infraestrutura

* Compatibilidade Railway.
* Redução de CPU.
* Redução de memória.
* Menor consumo de créditos.

---

# 📄 Licença

Projeto desenvolvido para fins educacionais e institucionais.

Todos os direitos reservados.

**Pedro-Henrique-Pereira (PHtw) © 2026**
