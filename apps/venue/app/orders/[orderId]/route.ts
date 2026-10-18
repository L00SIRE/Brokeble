import { sql } from "@/db";
import { loadOrderView } from "@/orders/store";
import { withTap } from "@/tap/withTap";

type Ctx = { params: Promise<{ orderId: string }> };

export const GET = withTap(async (_req, ctx: Ctx) => {
  const { orderId } = await ctx.params;
  const view = await loadOrderView(sql(), orderId); // never includes tokens or pay URLs
  return view ? Response.json(view) : Response.json({ error: "not_found" }, { status: 404 });
});
