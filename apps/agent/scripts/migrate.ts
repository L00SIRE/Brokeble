// pnpm db:migrate — applies db/migrations/*.sql in name order to $OWNER_DATABASE_URL, once each, each in a transaction.
// OWNER_DATABASE_URL is the schema owner (Supabase `postgres`; direct or session pooler, not the :6543 transaction
// pooler). Never tab_agent: db/roles.sql's default privileges cover only tables the owner creates. Local/CI only.
// Applied files are recorded in public.tab_schema_migrations. Roles are NOT a migration: run db/roles.sql once via psql.
import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.OWNER_DATABASE_URL;
if (!url) {
  console.error("db:migrate needs OWNER_DATABASE_URL (postgres-role URL; local/CI only, see db/README.md)");
  process.exit(1);
}
const dir = new URL("../../../db/migrations/", import.meta.url);
const sql = postgres(url, { max: 1, onnotice: () => {} });
class MigrationError extends Error {
  override name = "MigrationError";
}
let current: string | undefined;

try {
  await sql`create table if not exists public.tab_schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from public.tab_schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    current = name;
    const text = await readFile(new URL(name, dir), "utf8");
    // postgres.js sends plain SQL; a psql meta-command (\set, \gexec, :'VAR') would fail mid-file.
    if (/^\s*\\/m.test(text)) throw new MigrationError(`psql meta-commands are not allowed in migrations (put them in db/roles.sql)`);
    await sql.begin(async (tx) => {
      await tx.unsafe(text).simple();
      await tx`insert into public.tab_schema_migrations (name) values (${name})`;
    });
    console.log(`applied ${name}`);
  }
  console.log("db:migrate done");
} catch (e) {
  // Server-side SQL errors (PostgresError) are safe and useful to print; connection-level errors can name the host
  // or user, so for those print only the error name and code. Never print the error object.
  const err = e instanceof Error ? e : new Error("unknown");
  const code = "code" in err ? String(err.code) : "";
  const detail = err.name === "PostgresError" || err instanceof MigrationError ? `: ${err.message}` : "";
  console.error(`db:migrate failed${current ? ` in ${current}` : ""}: ${err.name}${code ? ` [${code}]` : ""}${detail}`);
  console.error("If a file was already applied by hand, record it: insert into public.tab_schema_migrations (name) values ('<file>');");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
