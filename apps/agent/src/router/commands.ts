// Command regex table and reply parsers (A plan T3 steps 5–7). Pure. Owner A.

export type Command =
  | { kind: "join"; code: string } // ^join\s+(\d{4})$
  | { kind: "help" } // ^(help|\?)$
  | { kind: "status" } // ^status$
  | { kind: "out" } // ^(i'?m out|i am out|out|stop|leave)$
  | { kind: "receipts" } // ^receipts?$
  | { kind: "remove_card" } // ^remove card$
  | { kind: "forget_me" } // ^forget me$
  | { kind: "cancel_plan" } // ^cancel plan$
  | { kind: "go" } // ^go$
  | { kind: "wait" } // ^wait$
  | { kind: "change_budget" }; // ^change budget$

/** trim, lowercase, curly apostrophe ’ → ', collapse inner whitespace. */
export function normalizeCommandText(text: string): string {
  return text.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
}

/** Normalized text without trailing sentence punctuation ("I'm out." / "yes!"); "?" is kept because it is the help command. */
const bare = (text: string): string => normalizeCommandText(text).replace(/[.!]+$/, "");

const SIMPLE: readonly [RegExp, Exclude<Command, { kind: "join" }>][] = [
  [/^(?:help|\?)$/, { kind: "help" }],
  [/^status$/, { kind: "status" }],
  [/^(?:i'?m out|i am out|out|stop|leave)$/, { kind: "out" }],
  [/^receipts?$/, { kind: "receipts" }],
  [/^remove card$/, { kind: "remove_card" }],
  [/^forget me$/, { kind: "forget_me" }],
  [/^cancel plan$/, { kind: "cancel_plan" }],
  [/^go$/, { kind: "go" }],
  [/^wait$/, { kind: "wait" }],
  [/^change budget$/, { kind: "change_budget" }],
];

/** The command `text` matches after normalizeCommandText, or null. */
export function parseCommand(text: string): Command | null {
  const t = bare(text);
  const join = /^join\s+(\d{4})$/.exec(t);
  if (join) return { kind: "join", code: join[1]! };
  return SIMPLE.find(([re]) => re.test(t))?.[1] ?? null;
}

/** Digits ballot /^\s*[1-3](\s*[, ]\s*[1-3])*\s*$/ → deduped indices in first-seen order ("1 3" → [1,3]); else null. */
export function parseDigitsBallot(text: string): number[] | null {
  if (!/^\s*[1-3](\s*[, ]\s*[1-3])*\s*$/.test(text)) return null;
  return [...new Set(text.match(/[1-3]/g)!.map(Number))];
}

/** holdGate reply: /^(y|yes|yeah|yep|ok)$/ → "yes", /^(n|no|nope)$/ → "no", else null (normalized text). */
export function parseYesNo(text: string): "yes" | "no" | null {
  const t = bare(text);
  if (/^(?:y|yes|yeah|yep|ok)$/.test(t)) return "yes";
  if (/^(?:n|no|nope)$/.test(t)) return "no";
  return null;
}

/** Budget tier reply /^[1-4]$/ → 1..4, else null. */
export function parseTier(text: string): 1 | 2 | 3 | 4 | null {
  const t = bare(text);
  return /^[1-4]$/.test(t) ? (Number(t) as 1 | 2 | 3 | 4) : null;
}
