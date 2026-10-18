// End-to-end over real Postgres and the mock messaging port: /start → /status gate → plan by createPlanRecord →
// owner's text → plan_ready; a friend's /join; the public preview; POST /plans auto-seat. DB-gated: runs only with
// TEST_DATABASE_URL (a throwaway database with db/migrations applied; never prod data).
import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "../db";
import { upsertDmRoute } from "../repo/dmRoutes";
import { getParticipant } from "../repo/participants";
import { findUserByPhone } from "../repo/users";
import { createPlanRecord } from "./createPlanRecord";
import { mountJoin } from "./routes";
import { CreatePlanResponse, JoinResponse, PlanPreview, StartResponse, StatusResponse } from "./schemas";
import { verifyStatusToken } from "./statusToken";

// 2000..9999 keeps the exchange code 2-9, so every number passes the API's US (NANP) phone rule.
const prefix = String(2000 + Math.floor(Math.random() * 8000));
const phone = (n: number) => `+1557${prefix}${String(n).padStart(3, "0")}`;
const app = new Hono();
mountJoin(app);
let ip = 0;
const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", "fly-client-ip": `172.16.0.${++ip}` }, body: JSON.stringify(body) });
const status = async (t: string) => StatusResponse.parse(await (await app.request(`/status?t=${encodeURIComponent(t)}`, { headers: { "fly-client-ip": `172.17.0.${++ip}` } })).json());

describe.skipIf(!process.env.TEST_DATABASE_URL)("chat-first entry (postgres)", () => {
  const planIds: string[] = [];
  const phones: string[] = [];

  afterAll(async () => {
    if (planIds.length) {
      await sql`delete from app.due_jobs where plan_id = any(${sql.array(planIds)}::uuid[])`.catch(() => undefined);
      await sql`delete from app.events where plan_id = any(${sql.array(planIds)}::uuid[])`;
      await sql`delete from app.participants where plan_id = any(${sql.array(planIds)}::uuid[])`;
      await sql`delete from app.plans where id = any(${sql.array(planIds)}::uuid[])`;
    }
    if (phones.length) {
      const ids = (await sql<{ id: string }[]>`select id from app.users where phone_e164 = any(${sql.array(phones)}::text[])`).map((r) => r.id);
      if (ids.length) {
        await sql`delete from app.dm_routes where user_id = any(${sql.array(ids)}::uuid[])`;
        await sql`delete from app.assignments where user_id = any(${sql.array(ids)}::uuid[])`;
        await sql`delete from app.users where id = any(${sql.array(ids)}::uuid[])`;
      }
    }
    await sql.end();
  });

  it("organizer: /start → waiting (gated) → chat creates the plan → owner texts → plan_ready; friend joins", async () => {
    const orgPhone = phone(1);
    phones.push(orgPhone, phone(2));
    const start = StartResponse.parse(await (await post("/start", { phone_e164: orgPhone, consent: true })).json());
    const claims = verifyStatusToken(start.status_token)!;
    expect(claims).toMatchObject({ p: null, r: "organizer" });

    expect(await status(start.status_token)).toMatchObject({ phase: "waiting", plan: null, first_name: null, steps: null, assigned_number: start.assigned_number });

    // The chat path (A2's startByChat) creates the plan with the organizer JOINED.
    const organizer = (await findUserByPhone(orgPhone))!;
    const { plan, join_url } = await createPlanRecord(organizer, { title: "Dinner + show", area: "Santa Monica", date: "2026-10-24", time_start: "19:00", time_end: "23:00", party_target: 4 }, { organizerStage: "JOINED" });
    planIds.push(plan.id);
    expect((await getParticipant(plan.id, organizer.id))!.stage).toBe("JOINED");

    // Still gated: the plan exists, but nobody has proven they own this number since the token was issued.
    expect(await status(start.status_token)).toMatchObject({ phase: "waiting", plan: null });

    await upsertDmRoute({ user_id: organizer.id, space_id: "sp_org", agent_user_id: "agent", agent_number: null });
    const ready = await status(start.status_token);
    expect(ready).toMatchObject({ phase: "plan_ready", role: "organizer", steps: { budget: false, prefs: false } });
    expect(ready.plan).toMatchObject({ code: plan.code, joined: 1, party_target: 4, status: "open", join_url, organizer_first_name: null });

    // A second /start for the same number answers exactly like a stranger's would.
    const again = StartResponse.parse(await (await post("/start", { phone_e164: orgPhone, consent: true })).json());
    expect([again.sms_body, again.assigned_number]).toEqual([start.sms_body, start.assigned_number]);

    const join = JoinResponse.parse(await (await post("/join", { code: plan.code, phone_e164: phone(2), consent: true })).json());
    expect(join).toMatchObject({ already_joined: false, sms_body: "I'm in for Dinner + show!", plan: { code: plan.code, joined: 1 } });
    const friend = (await findUserByPhone(phone(2)))!;
    expect((await getParticipant(plan.id, friend.id))!.stage).toBe("INVITED");
    expect(await status(join.status_token)).toMatchObject({ phase: "waiting", role: "guest", plan: null });

    const preview = PlanPreview.parse(await (await app.request(`/plans/${plan.code}`)).json());
    expect(preview).toMatchObject({ code: plan.code, joined: 1, status: "open" });

    // The organizer joining their own link from another device: already in, no second participant row.
    const own = JoinResponse.parse(await (await post("/join", { code: plan.code, phone_e164: orgPhone, consent: true })).json());
    expect(own.already_joined).toBe(true);
  });

  it("POST /plans seats the organizer and makes them an INVITED participant of the new plan", async () => {
    const orgPhone = phone(3);
    phones.push(orgPhone);
    const res = await post("/plans", { title: "Tacos", area: "Koreatown", date: "2026-10-24", time_start: "19:00", time_end: "23:00", party_target: 3, organizer: { phone_e164: orgPhone, first_name: "" } });
    expect(res.status).toBe(200);
    const out = CreatePlanResponse.parse(await res.json());
    const claims = verifyStatusToken(out.status_token)!;
    planIds.push(claims.p!);
    const organizer = (await findUserByPhone(orgPhone))!;
    expect(claims).toMatchObject({ u: organizer.id, r: "organizer" });
    expect((await getParticipant(claims.p!, organizer.id))!.stage).toBe("INVITED");
    const [seat] = await sql<{ n: number }[]>`select count(*)::int as n from app.assignments where user_id = ${organizer.id} and released_at is null`;
    expect(seat!.n).toBe(1);
    expect(out.qr_svg).toContain("<svg");
    expect(await status(out.status_token)).toMatchObject({ phase: "waiting", sms_body: "Hey SquadTab! Let's get planning." });
  });
});
