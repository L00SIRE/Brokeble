import { withTap } from "@/tap/withTap";

type Ctx = { params: Promise<{ bundleKey: string }> };

/** Honest stub: the demo merchant always has stock. */
export const GET = withTap(async (_req, ctx: Ctx) => {
  const { bundleKey } = await ctx.params;
  return Response.json({ available: /^bnd_[0-9a-f]{10}$/.test(bundleKey) });
});
