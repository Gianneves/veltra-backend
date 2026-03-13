import { PrismaClient } from '../generated/prisma/client.ts';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega o .env (importante para o runtime do Node)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não definida no runtime.');
}

// No Prisma 7, basta instanciar assim. 
// Ele buscará a config no prisma.config.ts automaticamente.
export const prisma = new PrismaClient({} as any);