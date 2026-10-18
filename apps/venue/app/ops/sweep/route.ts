import { opsAuthorized } from "@/opsAuth";
import { errCode, sweep } from "@/sweep";

export const maxDuration = 120;

/** 200 when every step ran; otherwise 500 with the failed step names and their error codes (codes only, never messages). */
export async function POST(req: Request) {
  try {
    if (!opsAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const r = await sweep();
    return Response.json(r, { status: r.ok ? 200 : 500 });
  } catch (e) {
    const code = errCode(e);
    console.error("venue sweep failed before any step", code); // e.g. env() validation; never the message
    return Response.json({ ok: false, failed: ["init"], codes: { init: code } }, { status: 500 });
  }
}
