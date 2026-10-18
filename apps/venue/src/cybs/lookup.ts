// Live "what does Cybersource itself say" view of an order's payments (Trust Console, "In Cybersource" panel).
// Each recorded payment_ops row is enriched with a Transaction Details lookup (GET /tss/v2/transactions/{id}).
// Privacy: only the allowlisted fields below ever leave this module. billTo, email, tokens, payer_ref and member
// budgets are never read. The shared testrest merchant is world-readable, so this adds no personal data to it.
import { sql } from "../db";
import { env } from "../env";
import { cybsService } from "./index";
import { cybsSource } from "./source";

export type LookupState = "live" | "pending" | "unavailable" | "simulated" | "none";

export type CybsTxnRow = {
  seq: number; // 1-based share number within the order; not a person identifier
  op: "auth" | "capture" | "reverse" | "timeout_reverse";
  attempt: number;
  recorded: string; // the venue's own outcome for this call: ok | rejected | unknown | sent
  cybs_id: string | null;
  lookup: LookupState;
  txn: null | {
    operation: string; // Cybersource application names mapped to words
    status: string | null;
    message: string | null; // Cybersource's own wording, e.g. "Request was processed successfully."
    reason_code: string | null;
    amount: string | null;
    currency: string | null;
    card_type: string | null;
    card_last4: string | null;
    submit_time: string | null;
    processor: string | null;
    merchant_id: string | null;
  };
};

export type CybsReport = {
  order_id: string | null;
  fetched_at: string;
  source: { id: string; label: string };
  environment: string | null; // CYBS_RUN_ENV, only when live
  rows: CybsTxnRow[];
};

type OpRow = { share_id: string; op: CybsTxnRow["op"]; attempt: number; status: string; cybs_id: string | null };

const CARD_TYPES: Record<string, string> = { "001": "Visa", "002": "Mastercard", "003": "American Express", "004": "Discover" };
const APP_WORDS: Record<string, string> = {
  ics_auth: "Authorization hold",
  ics_bill: "Capture",
  ics_auth_reversal: "Reversal",
  ics_credit: "Refund",
};
const OP_WORDS: Record<CybsTxnRow["op"], string> = {
  auth: "Authorization hold",
  capture: "Capture",
  reverse: "Reversal",
  timeout_reverse: "Reversal",
};

export const LOOKUP_TIMEOUT_MS = 4_000;
export const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { at: number; row: Pick<CybsTxnRow, "lookup" | "txn"> }>();
export const clearLookupCache = () => cache.clear();

const str = (v: unknown, max = 80): string | null => ((typeof v === "string" || typeof v === "number") && String(v).length <= max ? String(v) : null);
const last4 = (v: unknown) => (typeof v === "string" && /^\d{4}$/.test(v.slice(-4)) ? v.slice(-4) : null);

/** Allowlist projection of a TSS transaction. Anything not named here (billTo, email, tokens, PAN) is dropped. */
export function mapTransaction(d: any, op: CybsTxnRow["op"]): NonNullable<CybsTxnRow["txn"]> {
  const apps: unknown[] = Array.isArray(d?.applicationInformation?.applications) ? d.applicationInformation.applications : [];
  const names = apps.map((a: any) => str(a?.name, 40)).filter((n): n is string => !!n);
  // The application that matches this operation names it best; fall back to what the venue recorded.
  const appName = names.find((n) => APP_WORDS[n] && APP_WORDS[n] === OP_WORDS[op]) ?? names.find((n) => APP_WORDS[n]);
  const hit: any = apps.find((a: any) => a?.name === appName);
  const amounts = d?.orderInformation?.amountDetails ?? {};
  const card = d?.paymentInformation?.card ?? {};
  const type = str(card.type, 20);
  return {
    operation: appName ? APP_WORDS[appName]! : OP_WORDS[op],
    status: str(d?.applicationInformation?.status ?? hit?.status, 40),
    message: str(hit?.rMessage ?? d?.errorInformation?.message, 120),
    reason_code: str(d?.applicationInformation?.reasonCode, 10),
    amount: str(amounts.totalAmount ?? amounts.authorizedAmount, 20),
    currency: str(amounts.currency, 3),
    card_type: type ? (CARD_TYPES[type] ?? type) : null,
    card_last4: last4(card.suffix),
    submit_time: str(d?.submitTimeUTC ?? d?.submitTimeUtc, 40),
    processor: str(d?.processorInformation?.processor?.name),
    merchant_id: str(d?.merchantId ?? d?.merchantInformation?.merchantId, 40),
  };
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });

/** One live lookup. Never throws: any failure becomes a degraded row state. */
async function lookupOne(cybsId: string, op: CybsTxnRow["op"]): Promise<Pick<CybsTxnRow, "lookup" | "txn">> {
  const hit = cache.get(cybsId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.row;
  let row: Pick<CybsTxnRow, "lookup" | "txn">;
  try {
    const out = await withTimeout(cybsService().getTransaction(cybsId), LOOKUP_TIMEOUT_MS);
    if (out.kind === "ok") row = { lookup: "live", txn: mapTransaction(out.data, op) };
    // TSS indexes a new transaction 1 to 3 s after the call: a 404 is "not yet", not a failure.
    else if (out.kind === "rejected" && out.http === 404) row = { lookup: "pending", txn: null };
    else row = { lookup: "unavailable", txn: null };
  } catch {
    row = { lookup: "unavailable", txn: null };
  }
  // Only successes are cached; a failed or pending row is retried on the next poll.
  if (row.lookup === "live") cache.set(cybsId, { at: Date.now(), row });
  return row;
}

export async function buildReport(orderId?: string | null): Promise<CybsReport> {
  const db = sql();
  const src = cybsSource();
  const live = env().CYBS_MODE === "live";
  const base = { fetched_at: new Date().toISOString(), source: { id: src.id, label: src.label }, environment: live ? env().CYBS_RUN_ENV : null };
  const [order] = orderId
    ? await db<{ id: string }[]>`select id from venue.orders where id = ${orderId}`
    : await db<{ id: string }[]>`select id from venue.orders order by created_at desc limit 1`;
  if (!order) return { ...base, order_id: null, rows: [] };

  const ops = await db<OpRow[]>`
    select p.share_id, p.op, p.attempt, p.status, p.cybs_id
    from venue.payment_ops p join venue.shares s on s.id = p.share_id
    where s.order_id = ${order.id}
    order by s.id, p.id`;
  const seqOf = new Map<string, number>();
  for (const o of ops) if (!seqOf.has(o.share_id)) seqOf.set(o.share_id, seqOf.size + 1);

  const rows = await Promise.all(
    ops.map(async (o): Promise<CybsTxnRow> => {
      const head = { seq: seqOf.get(o.share_id)!, op: o.op, attempt: o.attempt, recorded: o.status, cybs_id: o.cybs_id };
      if (!o.cybs_id) return { ...head, lookup: "none", txn: null };
      if (!live) return { ...head, lookup: "simulated", txn: null }; // mock ids exist nowhere in Cybersource
      return { ...head, ...(await lookupOne(o.cybs_id, o.op)) };
    }),
  );
  return { ...base, order_id: order.id, rows };
}
