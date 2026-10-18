// NEEDS_ATTENTION helper: print Cybersource's view of a share's payment. Never retries a capture.
// Run: pnpm --filter @tab/venue exec tsx --env-file=<env> scripts/check-share.ts <shareId>
import { cybsService } from "../src/cybs";
import { sql } from "../src/db";

const id = process.argv[2];
if (!id) throw new Error("usage: check-share.ts <shareId>");
const [s] = await sql()<{ status: string; cybs_payment_id: string | null }[]>`select status, cybs_payment_id from venue.shares where id = ${id}`;
if (!s?.cybs_payment_id) throw new Error("share has no cybs_payment_id");
const ops = await sql()`select op, attempt, status, http_status, cybs_id from venue.payment_ops where share_id = ${id} order by id`;
console.log("share", id, s.status);
console.table(ops);
const t = await cybsService().getTransaction(s.cybs_payment_id);
console.log("cybersource:", t.kind, t.kind === "ok" ? { applicationInformation: (t.data as any).applicationInformation } : t.kind === "rejected" ? t.body : t.code);
await sql().end();
