# Veltra Backend

**Veltra** is a high-performance engine designed for hybrid athletes. It integrates performance data (such as Strava) with natural language processing and vector search, enabling deep insights into physical and technical evolution.

This repository contains a robust API built for scalability, utilizing the latest technologies in the Node.js ecosystem.

---

## Tech Stack

* **Runtime:** Node.js (v20+) with **TypeScript**
* **Framework:** **Nest.js** with modular architecture
* **Database:** **PostgreSQL** with **pgvector** extension for embedding processing
* **ORM:** **TypeORM** with active record pattern
* **Caching & Sessions:** **Redis** with httpOnly cookie-based session management
* **Authentication:** **Strava OAuth** with token rotation and Redis-backed sessions
* **API Documentation:** **Swagger** via `@nestjs/swagger`
* **IDs:** **UUID v7** (time-ordered) for native chronological sorting
* **Infrastructure:** **Docker** and **Docker Compose**
* **Rate Limiting:** **@nestjs/throttler**

---

## Authentication Flow

1. User is redirected to Strava for authorization
2. Strava redirects back with an authorization `code`
3. `POST /api/v1/auth/strava/callback` exchanges the code for access and refresh tokens
4. User is created or updated in PostgreSQL via TypeORM
5. Access token is cached in Redis with TTL based on Strava's `expires_at`
6. A UUID session is generated, stored in Redis (7-day TTL), and returned as an httpOnly cookie (`user_session`)

---

## Semantic Search & AI

Unlike traditional tracking systems, Veltra uses **1536-dimensional embeddings** to enable similarity searches.

This allows the system to answer complex queries such as:

> *"Which aerobic runs felt similar in effort to my last race?"*

---

## Getting Started

### Prerequisites

* Docker
* Docker Compose
* Node.js **v20+**

---

### 1. Clone the repository

```bash
git clone https://github.com/Gianneves/veltra-backend.git
cd veltra-backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up your environment

Create a `.env` file based on `.env.example` and fill in your configuration.

### 4. Spin up the services

```bash
docker compose up -d
```

### 5. Run the application

```bash
# Development mode (watch mode)
npm run start:dev

# Production mode
npm run build && npm run start:prod
```

### 6. API Documentation

With the server running, access Swagger UI at:

```
http://localhost:3000/api-doc
```

---

## Author

Developed by **Gian Neves**.
