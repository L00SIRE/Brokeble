import { env } from "../env";

export type CybsSource = { id: "sim" | "testrest" | "sandbox"; label: string };

/** What backs the payments right now, derived from env only. Shown on the pay page and tagged on ledger events. */
export function cybsSource(): CybsSource {
  const e = env();
  if (e.CYBS_MODE === "mock") return { id: "sim", label: "Simulated payments (no Cybersource call)" };
  if (e.CYBS_MERCHANT_ID === "testrest") return { id: "testrest", label: "Cybersource sandbox · shared public test merchant" };
  return { id: "sandbox", label: "Cybersource sandbox · team merchant" };
}

/** The shared public merchant is readable by anyone holding its published keys: never send typed names or ZIPs to it. */
export const isSharedSandbox = () => env().CYBS_MODE === "live" && env().CYBS_MERCHANT_ID === "testrest";
