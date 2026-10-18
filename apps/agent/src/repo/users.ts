// app.users. Owner A.
import { createHmac, randomUUID } from "node:crypto";
import { sql, type Db } from "../db";
import { env } from "../env";
import { isUuid } from "./sql";
import type { UserRow } from "./types";

/** payer_ref = hmacSha256Hex(secret, userId).slice(0, 32): 128 bits, matches CreateOrderRequest's ^[0-9a-f]{32}$. */
export function payerRefFor(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex").slice(0, 32);
}

// Dev/test only: env marks PAYER_REF_SECRET optional so mock mode boots without it. Production must set it: payer_ref
// is the only identity the venue sees, and a known key would let anyone map it back to user ids.
const DEV_PAYER_REF_SECRET = "tab-dev-payer-ref-secret-not-for-prod";
/** PAYER_REF_SECRET, or the dev fallback outside production. Also the root key for join/statusToken.ts (domain-separated). */
export function payerRefSecret(): string {
  if (env.PAYER_REF_SECRET) return env.PAYER_REF_SECRET;
  if (env.NODE_ENV === "production") throw new Error("PAYER_REF_SECRET is required in production");
  return DEV_PAYER_REF_SECRET;
}

/** One user by id, or null. */
export async function getUser(userId: string, tx: Db = sql): Promise<UserRow | null> {
  if (!isUuid(userId)) return null;
  const [row] = await tx<UserRow[]>`select * from app.users where id = ${userId}`;
  return row ?? null;
}

/** Router step 0, first lookup: by Photon sentBy.id. */
export async function findUserByPhotonId(photonUserId: string, tx: Db = sql): Promise<UserRow | null> {
  const [row] = await tx<UserRow[]>`select * from app.users where photon_user_id = ${photonUserId}`;
  return row ?? null;
}

/** Router step 0 fallback and /join: by E.164 phone. */
export async function findUserByPhone(phoneE164: string, tx: Db = sql): Promise<UserRow | null> {
  const [row] = await tx<UserRow[]>`select * from app.users where phone_e164 = ${phoneE164}`;
  return row ?? null;
}

/**
 * Insert-or-return by phone. A new row gets a JS-generated uuid so payer_ref = payerRefFor(id, PAYER_REF_SECRET)
 * is written in the same INSERT. An existing row keeps its id and payer_ref. first_name '' means unknown (the web no
 * longer asks for a name), so a blank never overwrites a real name; a non-blank one replaces it.
 */
export async function upsertUserByPhone(u: { phone_e164: string; first_name: string }, tx: Db = sql): Promise<UserRow> {
  const id = randomUUID();
  const [row] = await tx<UserRow[]>`
    insert into app.users (id, phone_e164, first_name, payer_ref)
    values (${id}, ${u.phone_e164}, ${u.first_name}, ${payerRefFor(id, payerRefSecret())})
    on conflict (phone_e164) do update
      set first_name = case when excluded.first_name = '' then app.users.first_name else excluded.first_name end
    returning *`;
  return row!;
}

/** Sets first_name only while it is still '' (the chat name step): never renames someone. True if it wrote. */
export async function setFirstName(userId: string, name: string, tx: Db = sql): Promise<boolean> {
  const clean = name.trim();
  if (!isUuid(userId) || clean === "" || clean.length > 40) return false;
  const rows = await tx`update app.users set first_name = ${clean} where id = ${userId} and first_name = '' returning id`;
  return rows.length > 0;
}

/**
 * When the user's latest inbound DM arrived (app.dm_routes.updated_at: set on insert and on every inbound), or null
 * if they never texted. Photon delivers only the assigned handle's own messages, so a time after a status token's
 * iat proves the token holder's number owner texted: the /status proof-of-possession gate.
 */
export async function lastInboundAt(userId: string, tx: Db = sql): Promise<Date | null> {
  if (!isUuid(userId)) return null;
  const [row] = await tx<{ updated_at: Date }[]>`select updated_at from app.dm_routes where user_id = ${userId}`;
  return row?.updated_at ?? null;
}

/** Sets photon_user_id once it is first seen on an inbound DM (unique column). */
export async function setPhotonUserId(userId: string, photonUserId: string, tx: Db = sql): Promise<void> {
  await tx`
    update app.users set photon_user_id = ${photonUserId}
    where id = ${userId} and photon_user_id is distinct from ${photonUserId}`;
}

/** Users for a set of payer_refs (venue events and order shares carry only payer_ref). */
export async function findUsersByPayerRefs(payerRefs: readonly string[], tx: Db = sql): Promise<UserRow[]> {
  if (payerRefs.length === 0) return [];
  return tx<UserRow[]>`
    select * from app.users where payer_ref = any(${tx.array([...payerRefs])}::text[]) order by created_at, id`;
}

/** "forget me": first_name='(removed)', phone_e164='forgotten:'||id, photon_user_id=null. */
export async function scrubUser(userId: string, tx: Db = sql): Promise<void> {
  await tx`
    update app.users set first_name = '(removed)', phone_e164 = 'forgotten:' || id::text, photon_user_id = null
    where id = ${userId}`;
}
