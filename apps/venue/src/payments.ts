// M6 around every Cybersource call: INSERT payment_ops BEFORE the call (unique (share_id, op, attempt) blocks
// double-sends), UPDATE after with a redacted subset. Never persists an SDK error object.
import { sql } from "./db";
import { opIds } from "./ids";
import { redact, type CybsOutcome } from "./cybs";

export type Op = "auth" | "capture" | "reverse" | "timeout_reverse";

export async function runOp<T>(
  shareId: string,
  op: Op,
  call: (ids: { code: string; transactionId: string }) => Promise<CybsOutcome<T>>,
): Promise<{ outcome: CybsOutcome<T>; attempt: number; transactionId: string }> {
  const [n] = await sql()<{ next: number }[]>`
    select coalesce(max(attempt), 0)::int + 1 as next from venue.payment_ops where share_id = ${shareId} and op = ${op}`;
  const attempt = n!.next;
  const ids = opIds(shareId, op, attempt);
  await sql()`
    insert into venue.payment_ops (share_id, op, attempt, client_ref_code, transaction_id, status)
    values (${shareId}, ${op}, ${attempt}, ${ids.code}, ${ids.transactionId}, 'sent')`;
  const outcome = await call(ids);
  const http = outcome.kind === "unknown" ? outcome.http : outcome.http;
  const data = outcome.kind === "ok" ? (outcome.data as any) : outcome.kind === "rejected" ? (outcome.body as any) : null;
  const cybsId = outcome.kind === "ok" && typeof data?.id === "string" ? data.id : null;
  const response = outcome.kind === "unknown" ? { code: outcome.code ?? null } : redact(data);
  await sql()`
    update venue.payment_ops set status = ${outcome.kind}, cybs_id = ${cybsId}, http_status = ${http},
      response = ${sql().json(JSON.parse(JSON.stringify(response)))}
    where share_id = ${shareId} and op = ${op} and attempt = ${attempt}`;
  return { outcome, attempt, transactionId: ids.transactionId };
}
