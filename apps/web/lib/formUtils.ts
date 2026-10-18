// Pure helpers shared by the join and create forms. No React, no storage: form values never leave component state.

export type Errors<K extends string> = Partial<Record<K, string>>;

/** Dollars typed by a person. null = left empty, "invalid" = not a plain amount, else a number (cents precision). */
export function parseUsd(raw: string): number | null | "invalid" {
  const s = raw.trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  return /^\d{1,4}(\.\d{1,2})?$/.test(s) ? Number(s) : "invalid";
}

/** Maps server issue paths ("budget_usd.hard_max") to form field keys; paths with no field set `rest`. */
export function mapIssues<K extends string>(
  issues: readonly { path: string }[],
  fieldFor: (path: string) => K | undefined,
  message: (field: K) => string,
): { errors: Errors<K>; rest: boolean } {
  const errors: Errors<K> = {};
  let rest = false;
  for (const { path } of issues) {
    const field = fieldFor(path);
    if (field) errors[field] ??= message(field);
    else rest = true;
  }
  return { errors, rest };
}

/** First key of `order` that has an error: the field to focus after a failed submit. */
export function firstError<K extends string>(order: readonly K[], errors: Errors<K>): K | undefined {
  return order.find((k) => errors[k]);
}
