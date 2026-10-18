import postgres from "postgres";
import { env } from "../env";

let client: postgres.Sql | undefined;

/**
 * Transaction pooler (:6543) has no prepared statements, hence prepare:false. Serverless hygiene (postgres.js README,
 * "Connection timeout"): close an idle connection after 20 s so a frozen or recycled Vercel instance does not keep a
 * pooler client slot (postgres.js's default idle_timeout is 0 = never), and fail a stuck connect in 10 s instead of 30 s.
 */
export function sql(): postgres.Sql {
  return (client ??= postgres(env().DATABASE_URL, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 }));
}
