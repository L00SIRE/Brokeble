// pnpm seed:demo — owner A (A plan T7/T14). Writes the demo plan and enqueues recompute; the running agent sends.
// Never prints phones, budgets or connection strings.
import { sql } from "../src/db";
import { errInfo } from "../src/log";
import { seedDemo } from "../src/ops/seed";

try {
  const { planId, code } = await seedDemo();
  console.log(`seeded demo plan ${planId} (code ${code})`);
} catch (e) {
  const { err, code } = errInfo(e);
  console.error(`seed:demo failed: ${code ?? ""} ${err}`.trim());
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
