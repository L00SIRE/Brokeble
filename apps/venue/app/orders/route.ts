import { ZodError } from "zod";
import { BadRequest, createOrder } from "@/orders/create";
import { withTap } from "@/tap/withTap";

export const POST = withTap(async (_req, _ctx: unknown, { body }) => {
  try {
    const { status, body: out } = await createOrder(JSON.parse(body.toString("utf8")));
    return Response.json(out, { status });
  } catch (e) {
    if (e instanceof ZodError || e instanceof SyntaxError || e instanceof BadRequest) {
      return Response.json({ error: "bad_request", message: e instanceof ZodError ? "invalid body" : e.message }, { status: 400 });
    }
    throw e;
  }
});
