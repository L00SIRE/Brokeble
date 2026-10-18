---
name: tab
description: Report progress to Tab and validate or submit Tab Scout options and Tab Concierge itineraries; use whenever a task mentions plan_ref, Tab Scout or Tab Concierge.
---
# tab CLI

Needs env vars TAB_API_BASE and TAB_AGENT_TOKEN (CREAO Secrets). Never print them.
Find the CLI: `TAB=$(command -v tab || ls ./tab 2>/dev/null)`. If empty:
`R=https://raw.githubusercontent.com/L00SIRE/Brokeble/main/skills/tab; mkdir -p schema && curl -fsSL $R/tab -o ./tab && curl -fsSL $R/schema/options.schema.json -o schema/options.schema.json && curl -fsSL $R/schema/itinerary.schema.json -o schema/itinerary.schema.json && chmod +x ./tab && TAB=./tab`

Commands (python3). Exit 0 = ok; 1 = validation errors printed as "path: message"; 2 = usage; 3 = env missing; 4 = network; 5 = not authorized, no active run, or server error.
- `$TAB ping`
- `$TAB progress --plan <plan_ref> --kind scout|concierge [--category dinner|show] "<step>"`
- `$TAB schema options|itinerary`
- `$TAB options validate <file>` then `$TAB options submit <file>`
- `$TAB itinerary submit <file>`

Loop: write the file → validate → fix exactly the reported paths → validate again (max 5) → submit.

If python3 is missing, use curl with the same JSON bodies:
`curl -fsS -X POST "$TAB_API_BASE/agent/options/validate" -H "Authorization: Bearer $TAB_AGENT_TOKEN" -H "Content-Type: application/json" --data @options.json`
(routes: /agent/ping, /agent/progress, /agent/options/validate, /agent/options, /agent/itinerary)
