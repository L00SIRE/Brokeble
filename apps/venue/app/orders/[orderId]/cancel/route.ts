import { z } from "zod";
import { cancelOrder } from "@/orders/cancel";
import { withTap } from "@/tap/withTap";

export const maxDuration = 120;
type Ctx = { params: Promise<{ orderId: string }> };
const Body = z.strictObject({ reason: z.string().max(200) });

export const POST = withTap(async (_req, ctx: Ctx, { body }) => {
  const { orderId } = await ctx.params;
  let reason: string;
  try {
    reason = Body.parse(JSON.parse(body.toString("utf8"))).reason;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const view = await cancelOrder(orderId, reason);
  return view ? Response.json(view) : Response.json({ error: "not_found" }, { status: 404 });
});
