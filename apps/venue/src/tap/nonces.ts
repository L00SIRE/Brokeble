import { sql } from "../db";
import type { NonceStore } from "./verify";

/** venue.tap_nonces, 8-minute window. Nonces are recorded only after a valid signature. */
export const dbNonces: NonceStore = {
  async seen(nonce) {
    const [r] = await sql()<{ ago: number }[]>`
      select extract(epoch from now() - seen_at)::int as ago from venue.tap_nonces
      where nonce = ${nonce} and seen_at > now() - interval '8 min'`;
    return r ? r.ago : null;
  },
  async record(nonce) {
    const rows = await sql()`
      insert into venue.tap_nonces (nonce) values (${nonce})
      on conflict (nonce) do update set seen_at = now() where venue.tap_nonces.seen_at <= now() - interval '8 min'
      returning nonce`;
    return rows.length > 0;
  },
};
