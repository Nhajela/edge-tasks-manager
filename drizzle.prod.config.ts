import { defineConfig } from "drizzle-kit";
import base from "./drizzle.config";

// pnpm db:push:prod: same schema, aimed at the Neon main branch
if (!process.env.DATABASE_URL_PROD) throw new Error("DATABASE_URL_PROD not set");
export default defineConfig({ ...base, dbCredentials: { url: process.env.DATABASE_URL_PROD } });
