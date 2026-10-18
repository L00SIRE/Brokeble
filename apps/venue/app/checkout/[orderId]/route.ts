import { checkout } from "@/orders/checkout";
import { withTap } from "@/tap/withTap";

export const maxDuration = 120; // up to 4 sequential captures at a 20 s SDK timeout
type Ctx = { params: Promise<{ orderId: string }> };

export const POST = withTap(
  async (_req, ctx: Ctx, { body, report }) => {
    const { orderId } = await ctx.params;
    const { status, result } = await checkout(orderId, body, report);
    return Response.json(result, { status });
  },
  async (report, ctx: Ctx) => {
    const { orderId } = await ctx.params;
    return Response.json({ order_id: orderId, result: "rejected", tap: report, captures: [] }, { status: 401 });
  },
);
