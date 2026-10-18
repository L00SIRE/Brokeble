import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { sweep } from "@/sweep";

export const maxDuration = 120;

function authorized(req: Request): boolean {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${env().VENUE_OPS_KEY}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await sweep());
}
