import postgres from "postgres";
import { env } from "./env";

// Fly runs one persistent machine on the Supabase session pooler (:5432), so prepared statements and
// LISTEN (used by events.ts) are both available. Connections open lazily on the first query.
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 60,
  connect_timeout: 10,
  onnotice: () => {},
  connection: { application_name: "tab-agent" },
});

export type Sql = typeof sql;
export type Tx = postgres.TransactionSql;
/** Either the pool or a transaction handle; helpers that take `tx?` run inside the caller's transaction. */
export type Db = Sql | Tx;
