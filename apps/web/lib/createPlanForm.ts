// "/" organizer form rules (B plan T8). Pure. Limits mirror CreatePlanBody in apps/agent/src/join/schemas.ts.
import type { CreatePlanRequest } from "./agent";
import { type Errors, mapIssues } from "./formUtils";
import { normalizePhone } from "./normalizePhone";

export type CreateField = "title" | "area" | "date" | "timeStart" | "timeEnd" | "partyTarget" | "firstName" | "phone";
export type CreateFields = Record<CreateField, string>;

export const CREATE_FIELD_ORDER: readonly CreateField[] = ["title", "area", "date", "timeStart", "timeEnd", "partyTarget", "firstName", "phone"];

const MESSAGES: Record<CreateField, string> = {
  title: "Give the plan a name, up to 80 characters.",
  area: "Enter a neighborhood or city, 2 to 60 characters.",
  date: "Pick today or a later date.",
  timeStart: "Pick a start time.",
  timeEnd: "Pick an end time after the start.",
  partyTarget: "Enter a group size from 2 to 8.",
  firstName: "Enter your first name.",
  phone: "Enter a valid phone number, like (310) 555-0123.",
};

export const createFieldMessage = (f: CreateField): string => MESSAGES[f];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** `today` is "YYYY-MM-DD" in the organizer's local time (injected so this stays pure). */
export function validateCreatePlan(
  f: CreateFields,
  today: string,
): { ok: true; body: CreatePlanRequest } | { ok: false; errors: Errors<CreateField> } {
  const errors: Errors<CreateField> = {};
  const title = f.title.trim();
  const area = f.area.trim();
  const firstName = f.firstName.trim();
  const phone = normalizePhone(f.phone);
  const party = /^\d$/.test(f.partyTarget.trim()) ? Number(f.partyTarget.trim()) : Number.NaN;

  if (title.length < 1 || title.length > 80) errors.title = MESSAGES.title;
  if (area.length < 2 || area.length > 60) errors.area = MESSAGES.area;
  if (!DATE.test(f.date) || f.date < today) errors.date = MESSAGES.date;
  if (!TIME.test(f.timeStart)) errors.timeStart = MESSAGES.timeStart;
  if (!TIME.test(f.timeEnd) || (TIME.test(f.timeStart) && f.timeEnd <= f.timeStart)) errors.timeEnd = MESSAGES.timeEnd;
  if (!(party >= 2 && party <= 8)) errors.partyTarget = MESSAGES.partyTarget;
  if (firstName.length < 1 || firstName.length > 40) errors.firstName = MESSAGES.firstName;
  if (!phone) errors.phone = MESSAGES.phone;

  if (Object.keys(errors).length > 0 || !phone) return { ok: false, errors };
  return {
    ok: true,
    body: { title, area, date: f.date, time_start: f.timeStart, time_end: f.timeEnd, party_target: party, organizer: { phone_e164: phone, first_name: firstName } },
  };
}

const PATH_FIELD: Record<string, CreateField> = {
  title: "title",
  area: "area",
  date: "date",
  time_start: "timeStart",
  time_end: "timeEnd",
  party_target: "partyTarget",
  "organizer.first_name": "firstName",
  "organizer.phone_e164": "phone",
};

export const mapCreateIssues = (issues: readonly { path: string }[]) => mapIssues(issues, (p) => PATH_FIELD[p], createFieldMessage);

/** Local "YYYY-MM-DD" (the en-CA locale formats as ISO). */
export const localToday = (now = new Date()): string => now.toLocaleDateString("en-CA");
