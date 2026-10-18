// Writes the JSON Schemas the `tab` CLI validates against (B's skills/tab). Run after any contract change: pnpm gen:skill-schema
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import { Itinerary, ScoutSubmission } from "../src/index";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../skills/tab/schema");
mkdirSync(outDir, { recursive: true });
for (const [file, schema] of [["options.schema.json", ScoutSubmission], ["itinerary.schema.json", Itinerary]] as const) {
  writeFileSync(resolve(outDir, file), `${JSON.stringify(z.toJSONSchema(schema), null, 2)}\n`);
  console.log(`wrote ${resolve(outDir, file)}`);
}
