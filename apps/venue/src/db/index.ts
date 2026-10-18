import postgres from "postgres";
import { env } from "../env";

let client: postgres.Sql | undefined;

/** Transaction pooler (:6543) has no prepared statements, hence prepare:false. */
export function sql(): postgres.Sql {
  return (client ??= postgres(env().DATABASE_URL, { prepare: false, max: 1 }));
}
