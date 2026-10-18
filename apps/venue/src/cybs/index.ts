import { env } from "../env";
import { liveCybs } from "./live";
import { mockCybs } from "./mock";
import type { CybsService } from "./service";

export type { AuthResp, AuthorizeArgs, BillTo, CybsOutcome, CybsService } from "./service";
export { classifyAuth, cardFromAuth, redact, reversalDone, timeoutReversalDone } from "./classify";
export { cybsSource, isSharedSandbox, type CybsSource } from "./source";

/** The only entry point to payments (M2). Mode is chosen by CYBS_MODE. */
export const cybsService = (): CybsService => (env().CYBS_MODE === "live" ? liveCybs : mockCybs);
