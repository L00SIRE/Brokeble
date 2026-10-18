// app.dm_routes: reply routing. Always reply with the stored route, never a guessed number. Owner A.
import { sql, type Db } from "../db";
import type { DmAddress } from "../ports";

/** Upserts the route from an inbound DM (space.id, receivedBy.id, receivedBy.handle). */
export async function upsertDmRoute(
  r: { user_id: string; space_id: string; agent_user_id: string; agent_number: string | null },
  tx: Db = sql,
): Promise<void> {
  await tx`
    insert into app.dm_routes (user_id, space_id, agent_user_id, agent_number)
    values (${r.user_id}, ${r.space_id}, ${r.agent_user_id}, ${r.agent_number})
    on conflict (user_id) do update set space_id = excluded.space_id, agent_user_id = excluded.agent_user_id,
      agent_number = coalesce(excluded.agent_number, app.dm_routes.agent_number), updated_at = now()`;
}

/** The user's reply address, or null if they never texted Tab (then nothing may be sent: shared-line rule). */
export async function getDmRoute(userId: string, tx: Db = sql): Promise<DmAddress | null> {
  const [row] = await tx<{ space_id: string; agent_user_id: string }[]>`
    select space_id, agent_user_id from app.dm_routes where user_id = ${userId}`;
  return row ? { userId, spaceId: row.space_id, agentUserId: row.agent_user_id } : null;
}

/** Normalize fallback when receivedBy is missing: the stored agent_user_id for this Photon sender, or null. */
export async function findAgentUserIdByPhotonUser(photonUserId: string, tx: Db = sql): Promise<string | null> {
  const [row] = await tx<{ agent_user_id: string }[]>`
    select d.agent_user_id from app.dm_routes d join app.users u on u.id = d.user_id
    where u.photon_user_id = ${photonUserId}`;
  return row?.agent_user_id ?? null;
}

/** "forget me". */
export async function deleteDmRoute(userId: string, tx: Db = sql): Promise<void> {
  await tx`delete from app.dm_routes where user_id = ${userId}`;
}
