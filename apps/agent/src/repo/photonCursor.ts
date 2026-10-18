// app.photon_cursor: the Socket.IO replay cursor (single row id=1). Owner A.
import { sql, type Db } from "../db";

/** The last fully handled delivery seq (0 = live only). */
export async function loadCursor(tx: Db = sql): Promise<number> {
  // bigint arrives as a string from postgres.js; Photon seqs stay far below 2^53.
  const [row] = await tx<{ seq: string }[]>`select seq from app.photon_cursor where id = 1`;
  return row ? Number(row.seq) : 0;
}

/** Saves seq after the handler for that delivery resolved; never moves backwards. */
export async function saveCursor(seq: number, tx: Db = sql): Promise<void> {
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error("saveCursor: seq must be a non-negative integer");
  await tx`
    insert into app.photon_cursor (id, seq) values (1, ${seq})
    on conflict (id) do update set seq = greatest(app.photon_cursor.seq, excluded.seq)`;
}
