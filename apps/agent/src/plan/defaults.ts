// Defaults for a plan whose organizer named no time (chat start, startByChat.ts). Owner A.
// 17:30 → 23:00 is the demo seed's window (fixtures/demo-seed.json): compose() needs a show starting T+90..T+150 that
// ends by time_end (decide/config.ts), and the evening listings Scout returns cluster around 19:00–20:00. A 19:00 start
// left only the 21:00+ shows, so the cached fallback found 2 distinct shows and ended in T_NO_FIT instead of a 3-option
// ballot. A time the organizer does give keeps start + 4 h (endTime).
import type { HHMM } from "@tab/shared";

export const DEFAULT_START: HHMM = "17:30";
export const DEFAULT_END: HHMM = "23:00";
