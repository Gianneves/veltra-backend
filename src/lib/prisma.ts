import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL não definida.');
}

// Criamos a conexão nativa do Postgres
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);

// Passamos o adapter explicitamente. 
// Isso MATA o erro de "engine type client" de uma vez por todas.
export const prisma = new PrismaClient({ adapter });