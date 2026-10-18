// P2: a delegate sees only its own person's inbound message, stage and first name. Owner A.
import type { DelegateInput } from "@tab/shared";
import { emit } from "../events";
import { errInfo, log } from "../log";

/** Returns exactly {user_first_name, stage, message_text: text.slice(0, 2000)} and nothing else (delegate.input test). */
export function buildDelegateInput(firstName: string, stage: DelegateInput["stage"], messageText: string): DelegateInput {
  return { user_first_name: firstName, stage, message_text: messageText.slice(0, 2000) };
}

/** Emits xray {contexts:[{name:`delegate:lane-${lane}`, locked:true, preview:null}]} for each delegate call (P8). Never throws. */
export async function emitDelegateXray(lane: number): Promise<void> {
  try {
    await emit({ type: "xray", contexts: [{ name: `delegate:lane-${lane}`, locked: true, preview: null }] });
  } catch (err) {
    log.warn({ lane, ...errInfo(err) }, "delegate xray emit failed");
  }
}
