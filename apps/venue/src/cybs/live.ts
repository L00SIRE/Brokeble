import cybs from "cybersource-rest-client";
import { env } from "../env";
import { cybsConfig, isSandboxHost } from "./config";
import type { AuthResp, AuthorizeArgs, CybsOutcome, CybsService } from "./service";

const usd = (cents: number) => (cents / 100).toFixed(2);

function safeJson(t: unknown): unknown {
  if (typeof t !== "string") return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Classifies on `status` only. Never reads or returns err.response.req (it holds the request body and auth headers). */
function invoke<T>(f: (cb: (e: any, d: T, r: any) => void) => void): Promise<CybsOutcome<T>> {
  return new Promise((resolve) => {
    try {
      f((err, data, resp) => {
        if (!err) return resolve({ kind: "ok", http: resp?.status ?? 201, data });
        const http: number | null = typeof err.status === "number" ? err.status : null;
        if (http !== null && http < 500) return resolve({ kind: "rejected", http, body: safeJson(err.response?.text) });
        resolve({ kind: "unknown", http, code: typeof err.code === "string" ? err.code : undefined });
      });
    } catch {
      resolve({ kind: "unknown", http: null, code: "SDK_THROW" });
    }
  });
}

const client = () => {
  const c = new cybs.ApiClient();
  c.timeout = 20_000;
  return c;
};

export function authBody(a: AuthorizeArgs) {
  if (a.sandboxTestCard && !isSandboxHost(env().CYBS_RUN_ENV)) throw new Error("sandboxTestCard is sandbox-only");
  const oneTap = !a.transientTokenJwt && !!a.customerId && !a.sandboxTestCard;
  const save = a.saveCard && !oneTap;
  const b = a.billTo;
  return {
    clientReferenceInformation: { code: a.code, transactionId: a.transactionId },
    processingInformation: {
      capture: false,
      commerceIndicator: "internet",
      ...(save
        ? {
            actionList: ["TOKEN_CREATE"],
            actionTokenTypes: ["customer", "paymentInstrument"],
            authorizationOptions: { initiator: { credentialStoredOnFile: true } },
          }
        : {}),
      ...(oneTap ? { authorizationOptions: { initiator: { type: "customer", storedCredentialUsed: true } } } : {}),
    },
    ...(a.transientTokenJwt ? { tokenInformation: { transientTokenJwt: a.transientTokenJwt } } : {}),
    ...(oneTap ? { paymentInformation: { customer: { id: a.customerId } } } : {}),
    ...(a.sandboxTestCard
      ? { paymentInformation: { card: { number: "4111111111111111", expirationMonth: "12", expirationYear: "2031" } } }
      : {}),
    orderInformation: {
      amountDetails: { totalAmount: usd(a.amountCents), currency: "USD" },
      billTo: {
        firstName: b.first_name,
        lastName: b.last_name,
        postalCode: b.postal_code,
        country: "US",
        email: b.email ?? "noreply@example.com",
        // S1 (sandbox): administrativeArea is required. The pay page collects only name + ZIP, so the rest are sandbox placeholders.
        address1: b.address1 ?? "1 Market St",
        locality: b.locality ?? "San Francisco",
        administrativeArea: b.administrativeArea ?? "CA",
      },
    },
    merchantInformation: { merchantDescriptor: { name: "TAB PARTNER VENUE" } },
  };
}

export const liveCybs: CybsService = {
  async captureContext() {
    const out = await invoke<string>((cb) =>
      new cybs.MicroformIntegrationApi(cybsConfig(), client()).generateCaptureContext(
        {
          clientVersion: "v2",
          targetOrigins: [env().VENUE_PUBLIC_URL.replace(/\/$/, "")],
          allowedCardNetworks: ["VISA", "MASTERCARD", "AMEX"],
          allowedPaymentTypes: ["CARD"],
        },
        cb,
      ),
    );
    if (out.kind !== "ok" || typeof out.data !== "string") throw new Error(`capture context failed (${out.kind})`);
    const ctx = JSON.parse(Buffer.from(out.data.split(".")[1]!, "base64url").toString());
    const data = ctx?.ctx?.[0]?.data ?? ctx?.[0]?.data;
    const clientLibrary = data?.clientLibrary;
    const clientLibraryIntegrity = data?.clientLibraryIntegrity;
    if (!clientLibrary || !clientLibraryIntegrity) throw new Error("capture context missing clientLibrary");
    return { jwt: out.data, clientLibrary, clientLibraryIntegrity };
  },
  authorize: (a) => invoke<AuthResp>((cb) => new cybs.PaymentsApi(cybsConfig(), client()).createPayment(authBody(a), cb)),
  capture: (id, code, cents) =>
    invoke((cb) =>
      new cybs.CaptureApi(cybsConfig(), client()).capturePayment(
        { clientReferenceInformation: { code }, orderInformation: { amountDetails: { totalAmount: usd(cents), currency: "USD" } } },
        id,
        cb,
      ),
    ),
  reverse: (id, code, cents, reason) =>
    invoke((cb) =>
      new cybs.ReversalApi(cybsConfig(), client()).authReversal(
        id,
        { clientReferenceInformation: { code }, reversalInformation: { amountDetails: { totalAmount: usd(cents), currency: "USD" }, reason } },
        cb,
      ),
    ),
  timeoutReverse: (code, origTransactionId, cents, reason) =>
    invoke((cb) =>
      new cybs.ReversalApi(cybsConfig(), client()).mitReversal(
        {
          clientReferenceInformation: { code, transactionId: origTransactionId },
          reversalInformation: { amountDetails: { totalAmount: usd(cents) }, reason },
        },
        cb,
      ),
    ),
  getTransaction: (id) => invoke((cb) => new cybs.TransactionDetailsApi(cybsConfig(), client()).getTransaction(id, cb)),
};
