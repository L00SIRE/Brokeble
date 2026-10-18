// The friend's first text after a web /join, over real Postgres and the mock messaging port (smoke finding: the
// forgiving join was dead because currentPlanForUser skips INVITED rows). DB-gated: runs only with TEST_DATABASE_URL
// (a throwaway database with db/migrations applied; never prod data).
import { randomUUID } from "node:crypto";
import type { InboundEvent } from "@tab/shared";
import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "../src/db";
import { createPlanRecord } from "../src/join/createPlanRecord";
import { mountJoin } from "../src/join/routes";
import { getParticipant, upsertParticipant } from "../src/repo/participants";
import { findUserByPhone, upsertUserByPhone } from "../src/repo/users";
import { route } from "../src/router/route";

// 2000..9999 keeps the exchange code 2-9, so every number passes the API's US (NANP) phone rule.
const prefix = String(2000 + Math.floor(Math.random() * 8000));
const phone = (n: number) => `+1558${prefix}${String(n).padStart(3, "0")}`;
const app = new Hono();
mountJoin(app);
let ip = 0;
const postJoin = (body: unknown) =>
  app.request("/join", { method: "POST", headers: { "content-type": "application/json", "fly-client-ip": `172.18.0.${++ip}` }, body: JSON.stringify(body) });

const text = (from: string, body: string): InboundEvent =>
  ({
    event_id: randomUUID(), seq: 1, message_id: `msg_${randomUUID()}`, platform: "imessage", from_handle: from,
    from_user_id: `pu_${randomUUID()}`, agent_user_id: "agent_test", space_id: `sp_${from}`, space_kind: "direct",
    content_type: "text", text: body, parent_message_id: null, received_at: new Date().toISOString(),
  }) as InboundEvent;

const PLAN = { title: "Dinner + show", area: "Santa Monica", date: "2026-10-24", time_start: "19:00", time_end: "23:00", party_target: 4 };

describe.skipIf(!process.env.TEST_DATABASE_URL)("router: first text after a web /join (postgres)", () => {
  const phones: string[] = [];
  const planIds: string[] = [];
  const newPlan = async (orgPhone: string) => {
    phones.push(orgPhone);
    const organizer = await upsertUserByPhone({ phone_e164: orgPhone, first_name: "Maya" });
    const { plan } = await createPlanRecord(organizer, PLAN, { organizerStage: "JOINED" });
    planIds.push(plan.id);
    return plan;
  };
  /** Template ids sent to this user, oldest first (the ledger stores ids only, never text). */
  const sentTo = async (userId: string) =>
    (await sql<{ template_id: string }[]>`select template_id from app.outbound_messages where user_id = ${userId} order by created_at, idempotency_key`).map((r) => r.template_id);
  const plansOrganizedBy = async (userId: string) => (await sql<{ n: number }[]>`select count(*)::int as n from app.plans where organizer_id = ${userId}`)[0]!.n;

  afterAll(async () => {
    const userIds = (await sql<{ id: string }[]>`select id from app.users where phone_e164 = any(${sql.array(phones)}::text[])`).map((r) => r.id);
    const ownPlans = userIds.length ? (await sql<{ id: string }[]>`select id from app.plans where organizer_id = any(${sql.array(userIds)}::uuid[])`).map((r) => r.id) : [];
    const ids = [...new Set([...planIds, ...ownPlans])];
    if (ids.length) {
      await sql`delete from app.due_jobs where plan_id = any(${sql.array(ids)}::uuid[])`.catch(() => undefined);
      await sql`delete from app.events where plan_id = any(${sql.array(ids)}::uuid[])`;
      await sql`delete from app.participants where plan_id = any(${sql.array(ids)}::uuid[])`;
      await sql`delete from app.plans where id = any(${sql.array(ids)}::uuid[])`;
    }
    if (userIds.length) {
      await sql`delete from app.outbound_messages where user_id = any(${sql.array(userIds)}::uuid[])`;
      await sql`delete from app.dm_routes where user_id = any(${sql.array(userIds)}::uuid[])`;
      await sql`delete from app.assignments where user_id = any(${sql.array(userIds)}::uuid[])`;
      await sql`delete from app.users where id = any(${sql.array(userIds)}::uuid[])`;
    }
    await sql.end({ timeout: 5 });
  });

  it('POST /join (no name) then "hey" → JOINED + T_JOIN_WELCOME_NAME, not T_START_HELLO or a new plan', async () => {
    const plan = await newPlan(phone(1));
    const friendPhone = phone(2);
    phones.push(friendPhone);
    expect((await postJoin({ code: plan.code, phone_e164: friendPhone, consent: true })).status).toBe(200);
    const friend = (await findUserByPhone(friendPhone))!;
    expect((await getParticipant(plan.id, friend.id))!.stage).toBe("INVITED");

    await route(text(friendPhone, "hey"));

    expect((await getParticipant(plan.id, friend.id))!.stage).toBe("JOINED");
    const sent = await sentTo(friend.id);
    expect(sent).toEqual(["T_JOIN_WELCOME_NAME"]);
    expect(await plansOrganizedBy(friend.id)).toBe(0);
  });

  it('POST /join with a name then "I\'m in for Dinner + show!" → T_JOIN_WELCOME + T_BUDGET_ASK', async () => {
    const plan = await newPlan(phone(3));
    const friendPhone = phone(4);
    phones.push(friendPhone);
    expect((await postJoin({ code: plan.code, phone_e164: friendPhone, first_name: "Rae", consent: true })).status).toBe(200);
    const friend = (await findUserByPhone(friendPhone))!;

    await route(text(friendPhone, "I'm in for Dinner + show!"));

    expect((await getParticipant(plan.id, friend.id))!.stage).toBe("JOINED");
    expect(await sentTo(friend.id)).toEqual(["T_JOIN_WELCOME", "T_BUDGET_ASK"]);
    expect(await plansOrganizedBy(friend.id)).toBe(0);
  });

  it("a live lane still owns the member's texts: a form-only INVITED row in a newer plan is not joined (overnight fix)", async () => {
    const mine = await newPlan(phone(5));
    const memberPhone = phone(6);
    phones.push(memberPhone);
    expect((await postJoin({ code: mine.code, phone_e164: memberPhone, first_name: "Ike", consent: true })).status).toBe(200);
    const member = (await findUserByPhone(memberPhone))!;
    await route(text(memberPhone, "JOIN " + mine.code));
    expect((await getParticipant(mine.id, member.id))!.stage).toBe("JOINED");

    // /join refuses this (in_other_plan); the row is written directly to model a form submitted before that check.
    const other = await newPlan(phone(7));
    await upsertParticipant(other.id, member.id);
    await route(text(memberPhone, "hey"));

    expect((await getParticipant(other.id, member.id))!.stage).toBe("INVITED");
    expect((await getParticipant(mine.id, member.id))!.stage).toBe("JOINED");
    const toOther = await sql<{ n: number }[]>`select count(*)::int as n from app.outbound_messages where user_id = ${member.id} and plan_id = ${other.id}`;
    expect(toOther[0]!.n).toBe(0);
  });
});
