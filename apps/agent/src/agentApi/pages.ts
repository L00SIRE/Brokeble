// Hosted itinerary pages linked from T_ITINERARY (B plan T11). Every field is HTML-escaped; Concierge HTML is never
// rendered. Headers: Cache-Control no-store, X-Robots-Tag noindex. Unknown ref → 404. Owner B.
import type { Context, Hono } from "hono";
import { Itinerary, PlanRef } from "@tab/shared";
import * as plans from "../repo/plans";
import * as researchRuns from "../repo/researchRuns";

/** Mounts GET /p/:planRef/itinerary and GET /p/:planRef/plan.ics. */
export function mountHostedPages(app: Hono): void {
  app.get("/p/:planRef/itinerary", handleItineraryPage);
  app.get("/p/:planRef/plan.ics", handleIcs);
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** & < > " ' → entities. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ENTITIES[ch]!);
}

const e = escapeHtml;

/** "18:30" → "6:30 PM". */
function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "2026-10-17" → "Saturday, October 17". UTC on purpose: a calendar date has no zone. */
function longDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

const CSS = `
:root{--bg:#f6f4ef;--card:#fff;--ink:#1c1b19;--muted:#6b675f;--line:#e4e0d6;--accent:#1f6f54;--accent-ink:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121411;--card:#1b1e1a;--ink:#f1efe8;--muted:#a09c91;--line:#2c3029;--accent:#52c29a;--accent-ink:#0d1a14}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}
.brand{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-size:26px;line-height:1.2;margin:8px 0 4px;text-wrap:balance}
h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:32px 0 12px}
.date{color:var(--muted);margin:0}
ol{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.stop,.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.time{font-variant-numeric:tabular-nums;font-weight:700;color:var(--accent)}
.stop h3{margin:2px 0 0;font-size:18px}
.addr{color:var(--muted);margin:2px 0 0;font-size:14px}
.notes{margin:8px 0 0}
dl{margin:0;display:grid;gap:14px}
dt{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
dd{margin:2px 0 0}
ul{margin:0;padding-left:20px;display:grid;gap:6px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}
.btn{display:inline-block;padding:12px 18px;border-radius:12px;font-weight:600;text-decoration:none;border:1px solid var(--line);color:var(--ink);background:var(--card)}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.btn:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
`;

/** A complete, self-contained, mobile-first HTML document from the stored Itinerary (all fields escaped). */
export function renderItineraryHtml(i: Itinerary): string {
  const stops = i.stops
    .map(
      (s) => `<li class="stop"><div class="time">${e(clock12(s.time))} · ${e(s.kind === "dinner" ? "Dinner" : "Show")}</div>
<h3>${e(s.name)}</h3><p class="addr">${e(s.address)}</p>${s.notes ? `<p class="notes">${e(s.notes)}</p>` : ""}</li>`,
    )
    .join("\n");
  const L = i.logistics;
  const rows: [string, string][] = [["Getting there", L.getting_there], ["Parking", L.parking], ["Doors", L.doors], ["Dress code", L.dress_code]];
  const logistics = rows.filter(([, v]) => v.trim()).map(([k, v]) => `<div><dt>${k}</dt><dd>${e(v)}</dd></div>`).join("\n");
  const know = L.know_before.length ? `<h2>Know before you go</h2><div class="card"><ul>${L.know_before.map((k) => `<li>${e(k)}</li>`).join("")}</ul></div>` : "";
  // z.url() accepts javascript: and data: URLs; only a web link may become an href.
  const notion = i.notion_url && /^https?:\/\//i.test(i.notion_url) ? `<a class="btn" href="${e(i.notion_url)}" rel="noopener noreferrer">Open in Notion</a>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="light dark">
<title>${e(i.title)} · SquadTab</title>
<style>${CSS}</style>
</head>
<body>
<main>
<div class="brand">SquadTab</div>
<h1>${e(i.title)}</h1>
<p class="date">${e(longDate(i.date))}</p>
<h2>Your night</h2>
<ol>
${stops}
</ol>
${logistics ? `<h2>Logistics</h2><div class="card"><dl>${logistics}</dl></div>` : ""}
${know}
<div class="actions"><a class="btn primary" href="plan.ics" download="tab-plan.ics">Add to calendar</a>${notion}</div>
</main>
</body>
</html>`;
}

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } as const;
const notFound = (c: Context) => c.text("Not found", 404, HEADERS);

/** The newest stored concierge itinerary for a plan ref, or null (unknown ref, no itinerary yet, or a stored value that no longer parses). */
async function loadItinerary(planRef: string): Promise<Itinerary | null> {
  if (!PlanRef.safeParse(planRef).success) return null;
  const plan = await plans.getPlanByRef(planRef);
  if (!plan) return null;
  const runs = await researchRuns.listRunsForPlan(plan.id, { kind: "concierge" }); // oldest first
  const stored = runs.findLast((r) => r.result?.itinerary)?.result?.itinerary;
  const parsed = Itinerary.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

/** getPlanByRef → newest concierge run's result.itinerary → text/html. */
export async function handleItineraryPage(c: Context): Promise<Response> {
  const it = await loadItinerary(c.req.param("planRef") ?? "");
  if (!it) return notFound(c);
  return c.html(renderItineraryHtml(it), 200, {
    ...HEADERS,
    // Defence in depth on top of escaping: the page needs inline CSS only; no script, image or frame is ever allowed.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
}

/** Same lookup → itinerary.ics as text/calendar; charset=utf-8, Content-Disposition attachment; filename="tab-plan.ics". */
export async function handleIcs(c: Context): Promise<Response> {
  const it = await loadItinerary(c.req.param("planRef") ?? "");
  if (!it) return notFound(c);
  return c.body(it.ics, 200, {
    ...HEADERS,
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'attachment; filename="tab-plan.ics"',
  });
}
