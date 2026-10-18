// /j/[code] form rules (B plan T8). Pure: the budget is only ever read from the form, validated and posted.
import type { JoinRequest } from "./agent";
import { type Errors, mapIssues, parseUsd } from "./formUtils";
import { normalizePhone } from "./normalizePhone";

export type JoinField = "phone" | "firstName" | "budgetTarget" | "budgetMax" | "consent";
export type JoinFields = { phone: string; firstName: string; budgetTarget: string; budgetMax: string; consent: boolean };

export const JOIN_FIELD_ORDER: readonly JoinField[] = ["phone", "firstName", "budgetTarget", "budgetMax", "consent"];

const MAX_USD = 1000;

const MESSAGES: Record<JoinField, string> = {
  phone: "Enter a valid phone number, like (310) 555-0123.",
  firstName: "Enter your first name.",
  budgetTarget: "Enter an amount between $1 and $1,000.",
  budgetMax: "Enter an amount between $1 and $1,000.",
  consent: "Agree to continue.",
};

export const joinFieldMessage = (f: JoinField): string => MESSAGES[f];

export function validateJoin(code: string, f: JoinFields): { ok: true; body: JoinRequest } | { ok: false; errors: Errors<JoinField> } {
  const errors: Errors<JoinField> = {};
  const phone = normalizePhone(f.phone);
  if (!phone) errors.phone = MESSAGES.phone;
  const firstName = f.firstName.trim();
  if (!firstName) errors.firstName = MESSAGES.firstName;
  else if (firstName.length > 40) errors.firstName = "Keep your name under 40 characters.";

  const target = parseUsd(f.budgetTarget);
  const max = parseUsd(f.budgetMax);
  const outOfRange = (n: number | null | "invalid") => n === "invalid" || (n !== null && (n <= 0 || n > MAX_USD));
  if (outOfRange(target)) errors.budgetTarget = MESSAGES.budgetTarget;
  if (outOfRange(max)) errors.budgetMax = MESSAGES.budgetMax;
  if (!errors.budgetTarget && !errors.budgetMax) {
    if (target === null && max !== null) errors.budgetTarget = "Add your target amount first.";
    else if (typeof target === "number" && typeof max === "number" && max < target) errors.budgetMax = "Your hard max can't be below your target.";
  }
  if (!f.consent) errors.consent = MESSAGES.consent;

  if (Object.keys(errors).length > 0 || !phone) return { ok: false, errors };
  const budget = typeof target === "number" ? { target, ...(typeof max === "number" && { hard_max: max }) } : undefined;
  return { ok: true, body: { code, phone_e164: phone, first_name: firstName, ...(budget && { budget_usd: budget }), consent: true } };
}

const PATH_FIELD: Record<string, JoinField> = {
  phone_e164: "phone",
  first_name: "firstName",
  budget_usd: "budgetTarget",
  "budget_usd.target": "budgetTarget",
  "budget_usd.hard_max": "budgetMax",
  consent: "consent",
};

/** Server 422 issues → field errors. Server wording is ignored (it is zod-technical); `rest` means "show a banner". */
export const mapJoinIssues = (issues: readonly { path: string }[]) => mapIssues(issues, (p) => PATH_FIELD[p], joinFieldMessage);

export type JoinFailure = "not_found" | "plan_closed" | "rate_limited" | "capacity" | "invalid" | "unknown";

/** Copy for each rejection (B plan T8 state table). not_found and plan_closed are terminal for this link. */
export const JOIN_FAILURE_COPY: Record<JoinFailure, { title: string; body: string; terminal: boolean }> = {
  not_found: { title: "That code doesn't match a plan", body: "Check the link your organizer sent you.", terminal: true },
  plan_closed: { title: "This plan isn't taking new people anymore", body: "Ask your organizer to start a new one.", terminal: true },
  capacity: { title: "Tab is at capacity, try again in a minute", body: "Your details weren't saved. Nothing was sent.", terminal: false },
  rate_limited: { title: "Tab is at capacity, try again in a minute", body: "Too many tries from this connection. Your details weren't saved.", terminal: false },
  invalid: { title: "Check the highlighted fields", body: "Something in the form wasn't accepted.", terminal: false },
  unknown: { title: "Something went wrong on our side", body: "Your details weren't saved. Please try again.", terminal: false },
};
