// Shared repo helpers. Owner A.
import { sql, type Db, type Tx } from "../db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guards lookups keyed by ids that can arrive from URLs or webhooks: a non-uuid would make Postgres throw 22P02. */
export const isUuid = (s: string): boolean => UUID_RE.test(s);

/** Runs `fn` inside the caller's transaction when one is passed, otherwise in a fresh one. */
export function inTx<T>(tx: Db | undefined, fn: (t: Tx) => Promise<T>): Promise<T> {
  if (tx && "savepoint" in tx) return fn(tx);
  return sql.begin((t) => fn(t)) as Promise<T>;
}

/** timestamptz → the IsoDateTime string the shared contracts use. */
export const iso = (d: Date): string => d.toISOString();
