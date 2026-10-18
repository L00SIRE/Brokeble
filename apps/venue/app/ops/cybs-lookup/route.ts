import { buildReport } from "@/cybs/lookup";
import { opsAuthorized } from "@/opsAuth";

export const maxDuration = 20;
export const dynamic = "force-dynamic";

/** GET /ops/cybs-lookup[?order=ord_...]: the order's Cybersource transactions, each looked up live. Ops key only. */
export async function GET(req: Request) {
  try {
    if (!opsAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const order = new URL(req.url).searchParams.get("order");
    if (order !== null && !/^ord_[a-z2-7]{10}$/.test(order)) return Response.json({ error: "bad_request" }, { status: 400 });
    return Response.json(await buildReport(order), { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 }); // never the message
  }
}
