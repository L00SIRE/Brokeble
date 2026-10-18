import { env } from "../env";

/** SDK merchant config. Logging disabled: no file writes, no request echo. */
export function cybsConfig() {
  const e = env();
  return {
    authenticationType: "jwt",
    jwtKeyType: "SHARED_SECRET",
    merchantID: e.CYBS_MERCHANT_ID,
    merchantKeyId: e.CYBS_KEY_ID,
    merchantsecretKey: e.CYBS_SECRET_KEY,
    runEnvironment: e.CYBS_RUN_ENV,
    logConfiguration: { enableLog: false },
  };
}
