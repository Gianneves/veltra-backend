# Veltra Backend 🏃‍♂️⚡️

**Veltra** is a high-performance engine designed for hybrid athletes. It integrates performance data (such as Strava) with natural language processing and vector search, enabling deep insights into physical and technical evolution.

This repository contains a robust API built for scalability, utilizing the latest technologies in the Node.js ecosystem.

---

## 🛠️ Tech Stack

* **Runtime:** Node.js (v20+) with **TypeScript** and **TSX**
* **Database:** **PostgreSQL** with **pgvector** extension for embedding processing
* **ORM:** **Prisma 7** featuring the new driver-agnostic configuration architecture
* **Caching:** **Redis** for queue management and search performance
* **IDs:** **UUID v7** (time-ordered) for native chronological sorting
* **Infrastructure:** **Docker** and **Docker Compose**

---

## 🧠 Technical Highlights

### Semantic Search & AI

Unlike traditional tracking systems, Veltra uses **1536-dimensional embeddings** to enable similarity searches.

This allows the system to answer complex queries such as:

> *"Which aerobic runs felt similar in effort to my last race?"*

---

## 🚀 Getting Started

### Prerequisites

* Docker
* Docker Compose
* Node.js **v20+**

---

## Installation

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

Create a `.env` file based on `.env.example`.

### 4. Spin up the services

```bash
docker-compose up -d
```

### 5. Run migrations

```bash
npx prisma migrate dev
```

---

## 👨‍💻 Author

Developed by **Gian Neves**.
