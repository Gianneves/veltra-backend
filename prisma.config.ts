import "dotenv/config";

import { defineConfig} from "prisma/config";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not defined in your environment variables");
}

export default defineConfig({
  datasource: {
    url: databaseUrl,
  },
});