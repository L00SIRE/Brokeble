// pnpm db:migrate — applies db/migrations/*.sql in name order to $DATABASE_URL, once each.
// Run as the schema owner (Supabase `postgres`), not tab_agent: e.g. `DATABASE_URL=<owner url> pnpm db:migrate`
// (a shell value overrides apps/agent/.env.local). Applied files are recorded in public.tab_schema_migrations.
// Files with psql meta-commands (003_roles.sql) go through psql with their `:'VAR'` values from the environment
// (AGENT_DB_PW, VENUE_DB_PW); if any is unset the file is skipped with a notice (single-role local dev).
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db:migrate needs DATABASE_URL (owner role)");
  process.exit(1);
}
const dir = new URL("../../../db/migrations/", import.meta.url);
const sql = postgres(url, { max: 1, onnotice: () => {} });

/** libpq env vars instead of argv, so no password shows up in the process list. */
function pgEnv(u: URL): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)) || "postgres",
    ...(u.searchParams.get("sslmode") ? { PGSSLMODE: u.searchParams.get("sslmode")! } : {}),
  };
}

try {
  await sql`create table if not exists public.tab_schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from public.tab_schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    const text = await readFile(new URL(name, dir), "utf8");
    if (/^\\/m.test(text)) {
      const vars = [...new Set([...text.matchAll(/:'(\w+)'/g)].map((m) => m[1]!))];
      const missing = vars.filter((v) => !process.env[v]);
      if (missing.length) {
        console.warn(`skip ${name}: needs ${missing.join(", ")} (see db/README.md)`);
        continue;
      }
      // Variables are \set on stdin, quoted psql-style ('' escapes '), so values never reach argv.
      const prelude = vars.map((v) => `\\set ${v} '${process.env[v]!.replace(/'/g, "''")}'\n`).join("");
      const r = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: prelude + text, env: pgEnv(new URL(url)), stdio: ["pipe", "inherit", "inherit"] });
      if (r.error || r.status !== 0) throw new Error(`${name}: psql failed${r.error ? ` (${r.error.message})` : ""}`);
      await sql`insert into public.tab_schema_migrations (name) values (${name})`;
    } else {
      await sql.begin(async (tx) => {
        await tx.unsafe(text).simple();
        await tx`insert into public.tab_schema_migrations (name) values (${name})`;
      });
    }
    console.log(`applied ${name}`);
  }
  console.log("db:migrate done");
} catch (e) {
  console.error(`db:migrate failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error("If a file was already applied by hand, record it: insert into public.tab_schema_migrations (name) values ('<file>');");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
