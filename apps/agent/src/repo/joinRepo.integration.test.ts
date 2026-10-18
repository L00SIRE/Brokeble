// SQL behind the chat-first entry (ux-flow §7.1): blank-name upserts, setFirstName, lastInboundAt and the
// /ops/release-untexted query. DB-gated like repo.integration.test.ts: runs only with TEST_DATABASE_URL (a throwaway
// database with db/migrations applied; never prod data).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "../db";
import * as assignments from "./assignments";
import * as dmRoutes from "./dmRoutes";
import * as users from "./users";

const prefix = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
const phone = (n: number) => `+1556${prefix}${String(n).padStart(3, "0")}`;

describe.skipIf(!process.env.TEST_DATABASE_URL)("join repo (postgres)", () => {
  const userIds: string[] = [];
  const newUser = async (n: number, first_name = "") => {
    const u = await users.upsertUserByPhone({ phone_e164: phone(n), first_name });
    userIds.push(u.id);
    return u;
  };
  /** A seat created `ageMin` minutes ago. */
  const seat = async (userId: string, ageMin: number) => {
    const a = await assignments.insertAssignment({ user_id: userId, photon_assignment_id: `asg_${randomUUID()}`, assigned_number: "+13105550001" });
    await sql`update app.assignments set created_at = now() - make_interval(mins => ${ageMin}::int) where id = ${a.id}`;
    return a;
  };
  /** The user's inbound route, last updated `ageMin` minutes ago. */
  const texted = async (userId: string, ageMin: number) => {
    await dmRoutes.upsertDmRoute({ user_id: userId, space_id: `sp_${userId}`, agent_user_id: "agent", agent_number: null });
    await sql`update app.dm_routes set updated_at = now() - make_interval(mins => ${ageMin}::int) where user_id = ${userId}`;
  };

  afterAll(async () => {
    if (userIds.length) {
      await sql`delete from app.dm_routes where user_id = any(${sql.array(userIds)}::uuid[])`;
      await sql`delete from app.assignments where user_id = any(${sql.array(userIds)}::uuid[])`;
      await sql`delete from app.users where id = any(${sql.array(userIds)}::uuid[])`;
    }
    await sql.end();
  });

  it("upsertUserByPhone: a blank name never overwrites a real one; a real one replaces blank or real", async () => {
    const u = await newUser(1, "");
    expect(u.first_name).toBe("");
    expect((await users.upsertUserByPhone({ phone_e164: phone(1), first_name: "Leo" })).first_name).toBe("Leo");
    const again = await users.upsertUserByPhone({ phone_e164: phone(1), first_name: "" });
    expect([again.id, again.first_name, again.payer_ref]).toEqual([u.id, "Leo", u.payer_ref]);
    expect((await users.upsertUserByPhone({ phone_e164: phone(1), first_name: "Leonard" })).first_name).toBe("Leonard");
  });

  it("setFirstName writes only while the name is blank", async () => {
    const u = await newUser(2, "");
    expect(await users.setFirstName(u.id, "  Sam ")).toBe(true);
    expect((await users.getUser(u.id))!.first_name).toBe("Sam");
    expect(await users.setFirstName(u.id, "Maybe")).toBe(false);
    expect((await users.getUser(u.id))!.first_name).toBe("Sam");
    expect(await users.setFirstName(u.id, "")).toBe(false);
    expect(await users.setFirstName("not-a-uuid", "X")).toBe(false);
  });

  it("lastInboundAt: null before any text, then dm_routes.updated_at", async () => {
    const u = await newUser(3);
    expect(await users.lastInboundAt(u.id)).toBeNull();
    const t0 = Date.now();
    await dmRoutes.upsertDmRoute({ user_id: u.id, space_id: "sp", agent_user_id: "agent", agent_number: null });
    const at = await users.lastInboundAt(u.id);
    expect(at).toBeInstanceOf(Date);
    expect(Math.abs(at!.getTime() - t0)).toBeLessThan(60_000);
  });

  it("listUntextedAssignments: old untexted seats only; texted-after-seat, young and team seats are kept", async () => {
    const neverTexted = await newUser(10);
    const textedBeforeSeat = await newUser(11);
    const textedAfterSeat = await newUser(12);
    const young = await newUser(13);
    const team = await newUser(14);
    const released = await newUser(15);

    const a1 = await seat(neverTexted.id, 20);
    const a2 = await seat(textedBeforeSeat.id, 20);
    await texted(textedBeforeSeat.id, 60); // texted on an earlier seat, never on this one
    await seat(textedAfterSeat.id, 20);
    await texted(textedAfterSeat.id, 10);
    await seat(young.id, 5);
    await seat(team.id, 20);
    const gone = await seat(released.id, 20);
    await assignments.markAssignmentReleased(gone.photon_assignment_id);

    const ours = new Set(userIds);
    const rows = (await assignments.listUntextedAssignments(15, [team.phone_e164])).filter((r) => ours.has(r.user_id));
    expect(rows.map((r) => r.id).sort()).toEqual([a1.id, a2.id].sort());
    expect((await assignments.listUntextedAssignments(30, [team.phone_e164])).filter((r) => ours.has(r.user_id))).toEqual([]);
  });
});
