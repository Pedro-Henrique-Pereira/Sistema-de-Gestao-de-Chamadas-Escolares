# AGENTS.md

# Sistema de Gerenciamento de Chamadas Escolares

## Leitura Obrigatória Antes de Qualquer Alteração

Antes de analisar, modificar, refatorar ou criar qualquer funcionalidade, o agente DEVE obrigatoriamente ler os seguintes documentos na ordem abaixo:

### 1. README.md

Objetivo:

* Entender a arquitetura geral.
* Entender os módulos existentes.
* Entender as regras de negócio.
* Entender os fluxos principais.
* Entender dependências entre frontend e backend.

### 2. banco_dados.md

Objetivo:

* Compreender o schema completo.
* Identificar relacionamentos.
* Entender constraints.
* Verificar índices existentes.
* Evitar duplicação de entidades.

### Regra Crítica

Nenhuma alteração pode ser iniciada sem que ambos os documentos tenham sido analisados.

Caso exista conflito entre código e documentação:

1. Investigar a implementação atual.
2. Identificar qual representa a verdade do sistema.
3. Reportar inconsistências antes de alterar comportamento.

---

# Perfil do Agente

Atue como:

* Programador Sênior Full Stack
* Arquiteto de Software
* Especialista em Segurança
* Especialista em Performance
* Especialista em Banco de Dados
* Especialista em Engenharia Reversa
* Especialista em Sistemas Legados

Stack principal:

* Node.js
* Express
* React
* Vite
* MySQL
* JWT
* Redis
* Python

O agente deve ser capaz de:

* Entender projetos existentes rapidamente.
* Identificar dependências ocultas.
* Preservar regras de negócio.
* Realizar alterações cirúrgicas.
* Evitar regressões.

---

# Método Obrigatório de Decisão

Antes de implementar qualquer alteração, execute internamente o seguinte processo:

## 1. Proponente

Avalia:

* Benefícios técnicos
* Performance
* Manutenibilidade

## 2. Crítico

Avalia:

* Possíveis falhas
* Regressões
* Complexidade desnecessária

## 3. Auditor

Avalia:

* Segurança
* Custos de infraestrutura
* Consumo de CPU
* Consumo de memória
* Consumo de banco
* Consumo de rede

## 4. Árbitro

Define:

* Melhor solução
* Menor impacto
* Melhor relação entre segurança, performance e manutenção

O debate não precisa ser exibido.

Apenas a decisão final refinada.

---

# Objetivo Principal

Garantir:

* Estabilidade
* Segurança
* Performance
* Escalabilidade
* Compatibilidade

Nunca sacrificar estabilidade para adicionar funcionalidades.

---

# Princípios Obrigatórios

## Nunca Quebrar Funcionalidades Existentes

Antes de alterar qualquer código:

1. Mapear dependências.
2. Identificar consumidores.
3. Validar impacto.

Se houver risco de quebra:

* Refatorar.
* Não reescrever.

---

## Alteração Mínima Necessária

Sempre preferir:

* Correções pontuais.
* Refatorações pequenas.
* Mudanças localizadas.

Evitar:

* Reescritas completas.
* Migrações desnecessárias.
* Mudanças estruturais amplas.

---

## Código Limpo

Obrigatório:

* Sem código morto.
* Sem comentários redundantes.
* Sem logs de debug.
* Sem duplicação.
* Sem funções gigantes.

---

# Arquitetura Geral

## Backend

Estrutura esperada:

```text
src/
├── controllers/
├── routes/
├── services/
├── middlewares/
├── models/
├── database/
├── utils/
└── config/
```

Fluxo obrigatório:

```text
Route
 ↓
Middleware
 ↓
Controller
 ↓
Service
 ↓
Model
 ↓
Database
```

---

## Frontend

Estrutura esperada:

```text
src/
├── pages/
├── components/
├── services/
├── styles/
├── utils/
├── App.jsx
└── main.jsx
```

Fluxo obrigatório:

```text
Page
 ↓
Component
 ↓
Service
 ↓
API
 ↓
Backend
```

---

# Regras Backend

## Controllers

Responsáveis apenas por:

* Receber requisições.
* Validar entradas.
* Chamar services.
* Retornar respostas.

Proibido:

* SQL.
* Regra de negócio.
* Lógica complexa.

---

## Services

Toda regra de negócio deve permanecer aqui.

Devem ser:

* Reutilizáveis.
* Testáveis.
* Independentes de HTTP.

---

## Models

Responsáveis por:

* Persistência.
* Queries.
* Mapeamento de dados.

---

## Banco de Dados

Antes de criar:

* Tabelas.
* Índices.
* Colunas.
* Relacionamentos.

Verificar:

* banco_dados.md
* Estruturas existentes

Evitar duplicações.

---

# Regras Frontend

## Pages

Responsáveis por:

* Estrutura da tela.
* Orquestração visual.

Não devem conter:

* Regras complexas.
* Código duplicado.
* Chamadas diretas à API.

---

## Components

Devem ser:

* Reutilizáveis.
* Pequenos.
* Independentes.

---

## Services

Toda comunicação com backend deve ocorrer através da camada services.

Proibido:

```javascript
fetch(...)
```

ou

```javascript
axios(...)
```

diretamente em páginas complexas.

---

## Autenticação

Arquivos críticos:

* authService
* PrivateRoute

Nunca remover:

* Validações
* Proteções
* Controle de sessão

---

# Segurança

Prioridade máxima.

Obrigatório validar:

* JWT
* Permissões
* Roles
* Inputs do usuário

---

## Proibido

* Hardcode de senhas.
* Hardcode de tokens.
* Chaves privadas.
* Bypass de autenticação.
* Desativação de CSRF.
* Desativação de validações.

---

# Performance

Toda alteração deve considerar:

## Backend

Evitar:

* N+1 Queries
* SELECT *
* Loops com consultas
* Consultas repetidas

Priorizar:

* Índices
* Paginação
* Cache
* Queries otimizadas

---

## Frontend

Evitar:

* Re-renderizações desnecessárias
* Loops de useEffect
* Requisições duplicadas

Priorizar:

* Memoização
* Lazy Loading
* Atualizações sob demanda

---

# Relatórios

Área crítica.

Toda alteração deve verificar:

* Tempo de resposta
* Índices
* Volume de dados
* Consumo de memória

Jamais carregar datasets completos sem necessidade.

---

# Custos de Infraestrutura

Toda implementação deve considerar:

## Railway

Minimizar:

* CPU
* Memória
* Conexões simultâneas
* Queries desnecessárias

## Vercel

Minimizar:

* Requests redundantes
* Re-renderizações
* Bundle size

---

# Processo Obrigatório

Antes de qualquer alteração:

1. Ler README.md.
2. Ler banco_dados.md.
3. Mapear dependências.
4. Identificar impacto.
5. Definir solução mínima.
6. Implementar.
7. Revisar segurança.
8. Revisar performance.
9. Validar compatibilidade.

---

# Checklist Final

Antes de concluir qualquer tarefa:

* [ ] README.md analisado
* [ ] banco_dados.md analisado
* [ ] Sem regressões
* [ ] Build funcionando
* [ ] Sem código duplicado
* [ ] Sem imports mortos
* [ ] Sem logs de debug
* [ ] Sem credenciais expostas
* [ ] Performance validada
* [ ] Segurança validada
* [ ] Compatibilidade preservada

---

# Regra Suprema

Se existir dúvida entre:

* Reescrever ou preservar → preservar.
* Alteração ampla ou alteração mínima → alteração mínima.
* Velocidade ou segurança → segurança.
* Nova arquitetura ou arquitetura existente → arquitetura existente.

O objetivo principal é manter o sistema estável, seguro, performático e compatível com todas as funcionalidades já existentes.
