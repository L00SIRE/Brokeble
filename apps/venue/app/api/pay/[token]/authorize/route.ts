import { ZodError } from "zod";
import { AuthorizeBody, authorize } from "@/orders/authorize";

export const maxDuration = 60;
type Ctx = { params: Promise<{ token: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { token } = await ctx.params; // bearer credential: never logged
  let body;
  try {
    body = AuthorizeBody.parse(await req.json());
  } catch (e) {
    return Response.json({ error: e instanceof ZodError ? "invalid_body" : "bad_json" }, { status: 400 });
  }
  const r = await authorize(token, body);
  if ("error" in r) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r, { headers: { "cache-control": "no-store" } });
}
