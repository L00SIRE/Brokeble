import { keyDirectory } from "@/tap/withTap";

type Ctx = { params: Promise<{ keyid: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { keyid } = await ctx.params;
  const jwk = Object.hasOwn(keyDirectory(), keyid) ? keyDirectory()[keyid] : undefined;
  if (!jwk) return Response.json({ error: "unknown keyid" }, { status: 404 });
  return Response.json({ ...jwk, kid: keyid, note: "mock Visa key directory (hackathon)" });
}
