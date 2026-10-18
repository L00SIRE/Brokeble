// Stand-in for the agent's /venue/hook: verifies the HMAC and prints VenueEvents. Set AGENT_HOOK_URL=http://localhost:8090 on the venue.
// Run: VENUE_HOOK_SECRET=<same as venue> pnpm --filter @tab/venue exec tsx scripts/hook-echo.ts
import { createServer } from "node:http";
import { verifyVenueHook } from "../../agent/src/venueClient/hook";

const secret = process.env.VENUE_HOOK_SECRET;
if (!secret) throw new Error("VENUE_HOOK_SECRET required");
createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const ev = verifyVenueHook(raw, new Headers(req.headers as Record<string, string>), secret);
    console.log(ev ? `✓ ${ev.type} order=${ev.order_id} share=${ev.share_id ?? "-"} ${JSON.stringify(ev.data).replace(/pay_url":"[^"]*/, 'pay_url":"<redacted')}` : "✗ rejected (bad signature, stale, or malformed)");
    res.statusCode = ev ? 200 : 401;
    res.end();
  });
}).listen(8090, () => console.log("hook-echo on :8090"));
