import { PostgresStore, PgVector } from '@mastra/pg';

declare global {
  var mastraPgStorage: PostgresStore | undefined;
  var mastraPgVector: PgVector | undefined;
}

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/mastra_demo';
const schemaName = process.env.DATABASE_SCHEMA ?? 'public';
const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;

const createStorage = () =>
  new PostgresStore({
    id: 'mastra-storage',
    connectionString,
    schemaName,
    max: 20,
    idleTimeoutMillis: 60000,
    ssl,
  });

const createVector = () =>
  new PgVector({
    id: 'mastra-vector',
    connectionString,
    schemaName,
    ssl,
  });

export const storage = globalThis.mastraPgStorage ?? createStorage();
export const vector = globalThis.mastraPgVector ?? createVector();

if (!globalThis.mastraPgStorage) {
  globalThis.mastraPgStorage = storage;
}

if (!globalThis.mastraPgVector) {
  globalThis.mastraPgVector = vector;
}
