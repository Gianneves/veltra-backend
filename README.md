# Veltra Backend

**Veltra** é uma plataforma inteligente de corrida que conecta atletas híbridos aos seus dados de performance via Strava, com insights gerados por IA.

Este repositório contém a API backend em NestJS, responsável por autenticação, armazenamento e processamento de dados.

---

## Tech Stack

- **Runtime:** Node.js (v20+) com **TypeScript**
- **Framework:** **NestJS** com arquitetura modular
- **Database:** **PostgreSQL** com extensão **pgvector** para embeddings
- **ORM:** **TypeORM** com padrão Data Mapper
- **Cache & Sessões:** **Redis** com cookies httpOnly
- **Autenticação:** **Strava OAuth** com rotação de tokens
- **IA:** **OpenAI** (text-embedding-3-small, GPT-4o-mini) via **LangChain**
- **Documentação:** **Swagger** via `@nestjs/swagger`
- **IDs:** **UUID v7** (ordenados cronologicamente)
- **Infraestrutura:** **Docker Compose**
- **Rate Limiting:** **@nestjs/throttler**

---

## Módulos da API

| Módulo | Prefixo | Descrição |
|---|---|---|
| Auth | `/api/v1/auth` | Login/logout Strava OAuth, gerenciamento de sessão |
| Activities | `/api/v1/activities` | Importação e consulta de atividades do Strava |
| Goals | `/api/v1/goals` | CRUD de metas com milestones automáticos (25/50/75%) |
| Training Plans | `/api/v1/training-plans` | Plano semanal auto-gerado com base no histórico |
| Coach | `/api/v1/coach` | Chat com IA com memória conversacional |
| Insights | `/api/v1/insights` | Insights gerados por IA sobre cada atividade |
| Analytics | `/api/v1/analytics` | Estatísticas agregadas semanais |
| Users | `/api/v1/users` | Gerenciamento de perfil de usuário |

---

## Fluxo de Autenticação

1. Usuário é redirecionado ao Strava para autorização
2. Strava redireciona com um `code` de autorização
3. `POST /api/v1/auth/strava/callback` troca o código por tokens de acesso
4. Usuário é criado/atualizado no PostgreSQL
5. Token de acesso é cacheado no Redis com TTL baseado no `expires_at` do Strava
6. Uma sessão UUID é gerada, armazenada no Redis (7 dias), e retornada como cookie httpOnly (`user_session`)

---

## Busca Semântica com Embeddings

O Veltra utiliza **embeddings de 1536 dimensões** (OpenAI text-embedding-3-small) para permitir buscas por similaridade semântica nas atividades.

Isso permite consultas como:

> *"Quais corridas aeróbicas tiveram esforço similar à minha última prova?"*

---

## Coach IA com Memória

O módulo Coach mantém histórico conversacional completo no banco de dados, enviando as últimas 20 mensagens + system prompt para a OpenAI gerar respostas personalizadas com base no desempenho do atleta.

---

## Getting Started

### Pré-requisitos

- Docker e Docker Compose
- Node.js v20+
- Conta no Strava (para criar aplicação e obter Client ID/Secret)
- Chave de API da OpenAI

### 1. Clone

```bash
git clone https://github.com/Gianneves/veltra-backend.git
cd veltra-backend
```

### 2. Instale dependências

```bash
npm install
```

### 3. Configure o ambiente

```bash
cp .env.example .env
# Edite .env com suas configurações (Strava Client ID/Secret, OpenAI Key, etc.)
```

### 4. Suba os serviços

```bash
docker compose up -d
```

### 5. Rode a aplicação

```bash
# Desenvolvimento (watch mode)
npm run start:dev

# Produção
npm run build && npm run start:prod
```

### 6. Documentação da API (Swagger)

Com o servidor rodando:

```
http://localhost:3001/api-doc
```

---

## Variáveis de Ambiente

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (padrão: `3001`) |
| `DATABASE_URL` | URL de conexão PostgreSQL |
| `REDIS_URL` | URL de conexão Redis |
| `STRAVA_CLIENT_ID` | Client ID do aplicativo Strava |
| `STRAVA_CLIENT_SECRET` | Client Secret do aplicativo Strava |
| `STRAVA_REDIRECT_URI` | URI de callback do Strava OAuth |
| `OPENAI_API_KEY` | Chave da API OpenAI |
| `FRONTEND_URL` | URL do frontend para CORS e redirects |
| `SESSION_SECRET` | Segredo para assinar cookies de sessão |

---

## Estrutura do Projeto

```
src/
├── activities/       # Importação e CRUD de atividades
├── ai/               # Serviço de IA (OpenAI + LangChain)
├── analytics/        # Estatísticas agregadas
├── auth/             # Autenticação Strava + gestão de sessão
├── coach/            # Chat com IA com memória
├── goals/            # Metas com milestones
├── insights/         # Insights por atividade
├── training-plans/   # Planos de treino semanais
├── users/            # Perfil de usuário
├── app.module.ts     # Módulo raiz
└── main.ts           # Entry point
```

---

## Autor

Desenvolvido por **Gian Neves**.
