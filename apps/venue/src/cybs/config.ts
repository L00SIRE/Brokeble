import { env } from "../env";

/** Test hosts only. The sandbox test card may be sent to these and nowhere else. */
export const SANDBOX_HOSTS = ["apitest.cybersource.com", "testrest.cybersource.com"];
export const isSandboxHost = (h: string) => SANDBOX_HOSTS.includes(h);

/** SDK merchant config. Logging disabled: no file writes, no request echo. */
export function cybsConfig() {
  const e = env();
  return {
    authenticationType: e.CYBS_AUTH_TYPE,
    ...(e.CYBS_AUTH_TYPE === "jwt" ? { jwtKeyType: "SHARED_SECRET" } : {}),
    merchantID: e.CYBS_MERCHANT_ID,
    merchantKeyId: e.CYBS_KEY_ID,
    merchantsecretKey: e.CYBS_SECRET_KEY,
    runEnvironment: e.CYBS_RUN_ENV,
    logConfiguration: { enableLog: false },
  };
}
