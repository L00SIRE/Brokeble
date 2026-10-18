// Tunable decision constants (B plan T6). No secrets. Owner B.
export const DINNER_MIN_MIN = 90; // dinner must stay open ≥ 90 min after plan start
export const SHOW_GAP_MIN = 90; // show starts ≥ T+90 min …
export const SHOW_GAP_MAX = 150; // … and ≤ T+150 min
export const HARD_MAX_SLACK = 1.1; // effectiveHardMax = hard_max ?? round(target × 1.10)
export const RATING_FLOOR = 0.05;
export const RATING_DEFAULT = 0.5; // a missing rating
export const COMFORT_FLOOR = 0.6;
export const MAX_RATED = 15;
export const SHORTLIST_N = 3;
