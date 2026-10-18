// LLM_MODE=mock: deterministic keyword parses so flows and tests run offline. Same contract as the real adapter:
// the input is one person's DelegateInput (P2) and the output is a schema value that code validates afterwards.
import { createHash } from "node:crypto";
import type { BallotConstraint, BallotParse, BudgetParse, DelegateInput, DietaryTag, Preferences, PublicBundle, RateCandidate, Ratings, Vibe } from "@tab/shared";
import type { LLMPort } from "./types";

const DIETARY: [RegExp, DietaryTag][] = [
  [/\bvegan\b/i, "vegan"], [/\bveg(etari)?an?\b|\bveggie\b/i, "vegetarian"], [/\bpescatarian\b/i, "pescatarian"],
  [/\bgluten\b|\bceliac\b/i, "gluten_free"], [/\bdairy\b|\blactose\b/i, "dairy_free"], [/\bnuts?\b/i, "nut_free"],
  [/\bhalal\b/i, "halal"], [/\bkosher\b/i, "kosher"],
];
const VIBES: [RegExp, Vibe][] = [
  [/\bcasual\b|\bchill\b/i, "casual"], [/\blively\b|\bfun\b/i, "lively"], [/\bquiet\b/i, "quiet"], [/\btrendy\b/i, "trendy"],
  [/\bclassic\b/i, "classic"], [/\boutdoors?\b|\bpatio\b/i, "outdoor"], [/\blate[- ]night\b/i, "late_night"],
];
const CUISINES = ["italian", "mexican", "thai", "sushi", "japanese", "korean", "indian", "chinese", "pizza", "burgers", "ramen", "tacos"];

/** "10" / "10:30" / "10pm" → "22:00"/"22:30": evening plans, so hours 1–11 are read as PM. */
function toHHMM(h: string, m?: string): string | null {
  let hour = Number(h);
  if (hour >= 1 && hour <= 11) hour += 12;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${m ?? "00"}`;
}
const timeAfter = (text: string, verb: RegExp): string | null => {
  const m = new RegExp(`${verb.source}\\s+(?:after\\s+)?(\\d{1,2})(?::(\\d{2}))?`, "i").exec(text);
  return m ? toHHMM(m[1]!, m[2]) : null;
};

export class MockLLM implements LLMPort {
  async parseBudget(i: DelegateInput): Promise<BudgetParse> {
    const nums = [...i.message_text.matchAll(/\$?\s?(\d{1,4}(?:\.\d{1,2})?)/g)].map((m) => Math.round(Number(m[1]) * 100));
    if (nums.length === 0) return { target_pp_cents: 0, hard_max_pp_cents: null, confidence: "low" };
    const [a, b = a] = nums as [number, number?];
    return { target_pp_cents: Math.min(a, b!), hard_max_pp_cents: Math.max(a, b!), confidence: "high" };
  }

  async parsePreferences(i: DelegateInput): Promise<Preferences> {
    const t = i.message_text;
    const avoid = CUISINES.filter((c) => new RegExp(`\\b(no|not|avoid|hate)\\s+${c}\\b`, "i").test(t));
    return {
      cuisines_like: CUISINES.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(t) && !avoid.includes(c)).slice(0, 5),
      cuisines_avoid: avoid.slice(0, 5),
      dietary: [...new Set(DIETARY.filter(([re]) => re.test(t)).map(([, tag]) => tag))],
      vibe: VIBES.filter(([re]) => re.test(t)).map(([, v]) => v).slice(0, 3),
      earliest_start: timeAfter(t, /(?:start(?:ing|s)?|not before)/),
      latest_end: timeAfter(t, /(?:nothing|not|ends?|done by|home by)/),
      dealbreakers: [],
    };
  }

  async parseBallot(i: DelegateInput, shortlist: PublicBundle[]): Promise<BallotParse> {
    const t = i.message_text;
    if (/\b(budget|afford|spend|max|how much)\b/i.test(t) && /\b(what|what's|how|whats)\b/i.test(t)) {
      return { approvals: [], constraints: [], none_of_these: false, intent: "ask_about_others", confidence: "high" };
    }
    const max = shortlist.length || 3;
    const approvals = [...new Set([...t.matchAll(/\b([1-3])\b/g)].map((m) => Number(m[1])))].filter((n) => n <= max);
    const none = /\b(none|neither|nothing works)\b/i.test(t);
    const constraints: BallotConstraint[] = [];
    const end = timeAfter(t, /ends?/);
    if (end) constraints.push({ kind: "end_before", time: end });
    const start = timeAfter(t, /starts?/);
    if (start) constraints.push({ kind: "start_after", time: start });
    const decided = approvals.length > 0 || none;
    return { approvals: none ? [] : approvals, constraints, none_of_these: none, intent: decided ? "ballot" : "other", confidence: decided ? "high" : "low" };
  }

  async rateBundles(prefs: Preferences, candidates: RateCandidate[]): Promise<Ratings> {
    const seed = JSON.stringify(prefs);
    return {
      ratings: candidates.map((b) => {
        const jitter = parseInt(createHash("sha256").update(seed + b.id).digest("hex").slice(0, 4), 16) / 0xffff;
        const fit = prefs.dietary.filter((d) => b.dietary_fit.includes(d)).length * 0.1;
        return { index: b.index, score: Math.min(1, Math.max(0.05, 0.4 + 0.4 * jitter + fit)) };
      }),
    };
  }

  async repairScoutJson(raw: string, _category: "dinner" | "show"): Promise<unknown> {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
    const body = fenced ?? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    return JSON.parse(body);
  }
}
