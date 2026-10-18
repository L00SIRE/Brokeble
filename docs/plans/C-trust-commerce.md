# Plan C: trust and commerce (`docs/plans/C-trust-commerce.md`)

**Owner:** C. **Written:** Sat 4:25 PM PDT. **Precedence:** `docs/PLAN.md` comes first, then this file. If they conflict, PLAN wins. Raise the conflict in team chat; never diverge silently. Items marked **[→ PLAN]** are conflicts found during verification. Settle each one with its owner at the 6:45 PM gate.

**Where the API facts come from** (checked Sat 4:25–5:30 PM; full list in the Verification log):
- **SDK:** `cybersource-rest-client@0.0.84` source, read from `https://unpkg.com/cybersource-rest-client@0.0.84/…`. This is npm `latest`, published 2026-10-05. Files read: `src/api/*.js`, `src/ApiClient.js`, `src/authentication/core/MerchantConfig.js`, `src/authentication/logging/*`, `src/index.js`, `README.md`.
- **REST spec:** the Cybersource REST spec JSON from the planning research. It is 20 MB, so don't commit it. `docs/research/` holds only a pointer to it.
- **Official samples:** `CyberSource/cybersource-rest-samples-node` and `CyberSource/cybersource-flex-samples-node/express-microform`.
- **Cybersource developer docs:** the Microform v2 server-side context page and `hello-world/testing-guide.md`.
- **Visa TAP spec page.**
- **RFC 9421 and RFC 9530.**
- **Next.js 16.4.2 docs** (the GitHub tag `v16.4.2`) and the **Vercel function-duration docs**.
- **`node:crypto` Ed25519**, run locally on Node 22.20.0.

Anything these sources don't confirm is tagged **UNVERIFIED** and has a smoke test in §11.

---

## 1. Context and goal

Tab's money promise is **"nobody pays until everyone's in."** You build the merchant side that makes it true and checkable:
- **Tab Partner Venue (sandbox merchant of record)** sells a **prepaid, ticketed dinner + show bundle**.
- Each friend places their own **cardholder-initiated authorization** (`capture:false`) on a Microform v2 page.
- Tab's agent can commit the purchase only with an **Ed25519 RFC 9421 signature (Visa Trusted Agent Protocol)**. The signature covers the **exact consent set**, and the venue rebuilds that set from its own DB.
- The venue captures every share or none. A decline, an "I'm out" or a missed deadline releases every hold.

**Prizes this work wins:**

| Prize | Your contribution |
|---|---|
| **Visa $2,000** (Innovation 25, UX 25, Technical 20, Commerce Impact 15, Trust 15) | The Visa table in PLAN §2.3: real sandbox auth, capture, reverse and timeout reversal; the Microform pay page with 7 states; one-tap saved card (TMS + COF flags); the TAP signer and 6-step verifier; live tamper, replay, expired and wrong-tag rejections; the mock key directory labelled "mock"; "released" wording. You lead the Visa pitch. |
| **Overall / Applied Intelligence** (Technical Depth, Execution) | Exactly-once commit, the TAP verifier, never-blind-retry idempotency. |
| **Never-cut items you own** | All-or-nothing holds; decline releases all; TAP verify + tamper; the console ledger data. |

---

## 2. What you own and what you must NOT touch

**You own (create and edit freely):**

| Path | Contents |
|---|---|
| `apps/venue/**` | Routes: `/`, `/pay/[token]`, `/api/pay/[token]/authorize`, `/availability/[bundleKey]`, `/orders`, `/orders/[orderId]`, `/orders/[orderId]/cancel`, `/checkout/[orderId]`, `/keys/[keyid]`, `/ops/sweep`. Modules: `src/{tap,cybs,pricing-bridge,db,outbox,ids,token,sweep}`. Also `scripts/*` and `test/*`. |
| `apps/agent/src/tap/**` | `signer.ts`, `keygen.ts` |
| `apps/agent/src/venueClient/**` | `index.ts` (the real `VenuePort`), `hook.ts`, `tapTest.ts`, `sweep.ts`, `ledger.ts` |
| `packages/shared/src/tap.ts` | The bodies of the consent canonicalization, the signature-base builder and the parsers. The foundation creates the file. **Announce any signature change; additive-only after 11 PM.** Import it via the subpath `@tab/shared/tap` so `node:crypto` never reaches `apps/web` bundles (confirm the export map with the foundation). |
| `db/migrations/005_venue_*.sql` onward (004 is A's) | New additive venue migrations only. Never edit `002_venue.sql` after it has been applied. |

**Co-owned (announce before editing):**
- `packages/shared/src/pricing.ts`, with B. B confirms `TAX`.
- The venue contracts in `packages/shared/src/index.ts` (additive only).

**Do NOT touch** (ping the owner instead):

| Path | Owner |
|---|---|
| `apps/agent/src/{photon,router,delegates,plan,notify,jobs,join,ops,money,repo}` | A (`money/holdGate.ts` is A's; see §3.3) |
| `apps/agent/src/{creao,decide,agentApi,voice}`, `apps/web/**`, `skills/tab/**` | B |
| `packages/shared/src/{private.ts,templates.ts}`, `db/migrations/001_app.sql`, `db/roles.sql` | foundation / A |

**Hard rules for your code** (PLAN §4, M1–M9):
- No Cybersource credentials, TMS tokens or card data outside `apps/venue` / schema `venue`.
- No budget or private-constraint data ever reaches the venue. The venue sees only `plan_ref`, `payer_ref` and bundle data.
- The venue never stores `bill_to` (name, ZIP, email). It goes to Cybersource only.
- Never log or persist an SDK error object whole. The SDK's `err.response.req` holds the **request body** (transient token, or the PAN in scratch) and the **auth headers**.
- Pay URLs are bearer credentials. They never go into `app.events`, SSE, pino logs or `GET /orders/{id}`.
- Never copy code from `visa/trusted-agent-protocol`. Its license binds you to the Visa TAP Product Terms, and the sample is non-conformant. Write your own.
- The pay page shows **no real business's name or brand**. It shows "Prepaid dinner + show bundle", the date, times and party size. Third-party names stay in iMessage.

---

## 3. Interfaces you consume and provide (exact PLAN names)

### 3.1 You provide

| Interface | Contract (PLAN §8 / §9 / §18) | Consumer |
|---|---|---|
| `GET /availability/{bundleKey}`, TAP `agent-browser-auth` | `{available:boolean}` | A, via `VenuePort.checkAvailability` |
| `POST /orders`, TAP `agent-payer-auth` + `content-digest` | `CreateOrderRequest` → `CreateOrderResponse` | A, via `VenuePort.createOrder` |
| `GET /orders/{id}`, `agent-browser-auth` | `OrderStatus` (no pay URLs or tokens) | A, via `VenuePort.getOrder` |
| `POST /checkout/{orderId}`, `agent-payer-auth`; body = canonical `ConsentSet` bytes | `CommitResult` (with `tap: TapVerifyReport`) | A, via `VenuePort.commit` |
| `POST /orders/{id}/cancel`, `agent-payer-auth`; body `{"reason":string}` | `OrderStatus` | A, via `VenuePort.cancel` |
| `GET /keys/[keyid]` | JWK `{kty:"OKP",crv:"Ed25519",x,kid}` plus `"note":"mock Visa key directory (hackathon)"` | verifier; judges |
| `POST /ops/sweep` (Bearer `VENUE_OPS_KEY`) | `{ok, timeout_reversed, expired_cancelled, outbox_delivered, nonces_purged}` | A's due_jobs, every 30 s |
| Venue → `POST AGENT_HOOK_URL` | `VenueEvent`; headers `X-Tab-Timestamp` and `X-Tab-Signature: sha256=<hex HMAC(VENUE_HOOK_SECRET, ts + "." + body)>` | A's state machine, via your `hook.ts` |
| `/pay/[token]` + `POST /api/pay/[token]/authorize` | `{transientTokenJwt?, save_card, bill_to}` → `{state, card?:{brand,last4}, retry_url?}` | phone browser |
| `apps/agent/src/venueClient` | The real `VenuePort` exactly as in PLAN §9, including `commit(orderId, consent, test?)` | A (calls), B (`/ops/tap-test` panel) |
| SSE (emitted by the agent) | `tap.signed`, `tap.verify`, `ledger`, `counters` (strict `SseEvent`) | B (console) |

**VenueEvent `data` payloads.** `data` is a `record`, so these stay inside the contract. Every event gets `event_id = 'evt_' + 16 base32` at enqueue time. It is stored in the outbox row, so a redelivery carries the same id and A's `inbound_events` dedupe works.

| `type` | `data` |
|---|---|
| `share.authorizing` | `{}` |
| `share.authorized` | `{amount_cents, card_brand, card_last4, cybs_payment_id_short}` |
| `share.declined` | `{pay_url, expires_at}`: a new single-use link for `T_DECLINED_RETRY` |
| `share.auth_unknown` | `{}` |
| `share.released` | `{retry: boolean, pay_url?, expires_at?}` |
| `share.captured` | `{amount_cents, cybs_capture_id_short}` |
| `order.captured` | `{total_cents}` |
| `order.cancelled` | `{reason}` |
| `order.needs_attention` | `{share_ids}` |

The venue does **not** emit `tap.verified`, although it is in the enum. The agent emits SSE `tap.verify` from the synchronous `CommitResult.tap` (or the 401/409 body), so nothing is duplicated.

`payer_ref` = `hmacSha256Hex(PAYER_REF_SECRET, userId).slice(0, 32)` (PLAN §6, settled).

### 3.2 You consume

- From `@tab/shared` (pricing.ts): `priceBundle()` and its constants.
- Contracts: `CreateOrderRequest`, `CreateOrderResponse`, `OrderStatus`, `VenueBundle`, `OrderItem`, `ConsentSet`, `ShareStatus`, `TapVerifyReport`, `CommitResult`, `VenueEvent`, `SseEvent`.
- From the foundation: `emit()` (agent events → SSE), the mock `VenuePort`, due_jobs, `002_venue.sql`, env plumbing.

### 3.3 holdGate (PLAN M7)

holdGate lives **in the agent** (`apps/agent/src/money/holdGate.ts`, A's file), because only the agent may read budgets (P1). The venue never sees a budget. Your part:
1. A pay URL leaves the venue only by these routes:
   - the TAP-authenticated `CreateOrderResponse`;
   - an HMAC-signed `VenueEvent` to the agent;
   - the `retry_url` returned to the browser that has just presented that share's previous single-use token.

   Pay URLs are never emailed, never in `GET /orders/{id}`, never in SSE or logs.
2. Review A's `holdgate.test.ts` as the payments owner.
3. Own the Visa framing: "a spending limit only you can lift".

**Open items with A (confirm at 6:45):**
- Settled: A stores current pay URLs in `app.pay_links` (A's migration 004) and overwrites them on `share.declined` and `share.released{retry:true}`. `PAY_LINK_TTL_MIN=1440` (PLAN §11), so links live until `deadline_at`.

---

## 4. Before the foundation lands (4:25–6:00 PM)

### 4.1 Accounts (in order)

| # | Do | Done when |
|---|---|---|
| 1 | **4:25 now:** sign up at https://developer.cybersource.com/hello-world/sandbox.html. The Organization ID becomes the merchant ID and can't be reused for go-live. Activation time is **UNVERIFIED**. Then go to the Visa booth (§4.2). | Activation email received |
| 2 | Log in to the test Business Center from the activation email. Go to **Payment Configuration → Key Management → Generate Key → REST – Shared Secret → Generate**. Copy or download both values right away: the first is the Key ID (`CYBS_KEY_ID`), the second is the shared secret (`CYBS_SECRET_KEY`). The Organization/merchant ID goes in `CYBS_MERCHANT_ID`. Guide: https://docs.cybersource.com/content/dam/documentation/en/admin/security-keys/creating_and_using_security_keys.pdf | Values in the password manager, **never in chat or git** |
| 3 | Vercel: import A's GitHub repo as project **`tab-venue`**, Root Directory `apps/venue`, framework Next.js. B does `tab-web`. The build may fail until 6:00; that's fine. Record the production domain (for example `https://tab-venue.vercel.app`) as `VENUE_PUBLIC_URL`, and its host as `VENUE_PUBLIC_HOST`. **Use the production domain only**: the Microform `targetOrigins` won't match preview URLs. | Domain sent to Claude's operator |
| 4 | Cybersource developer MCP (docs only, never keys). Verified on PyPI (v0.0.3): `pipx install cybersource-developer-mcp && claude mcp add cybersource-developer-mcp -- cybersource-developer-mcp start` | MCP answers a query |
| 5 | Create a Visa Developer account only if a Visa MCP feature asks for OAuth. | — |

### 4.2 Visa booth questions (by 6:45; record answers in PLAN §19)

1. Is a **labelled mock key directory** acceptable? Is agent registration (`/icc/v1/agents`, present in the 0.0.84 spec and SDK `AgentRegistrationApi`) open to hackathon sandbox merchants?
2. Are `@method` + `content-digest` acceptable as declared TAP extensions? Is the tag usage right: `agent-browser-auth` on GETs; `agent-payer-auth` on `POST /orders`, `/checkout`, `/cancel`?
3. Is "N cardholder-initiated auths captured all-or-nothing at one merchant of record" the pattern Visa would recommend?
4. Do judges weight real Cybersource sandbox transactions?
5. How long does sandbox activation take? Is TMS (TOKEN_CREATE) enabled on new sandboxes? Is `merchantDescriptor` allowed on sandbox merchants?
6. Is the 15-minute `DUPLICATE_REQUEST` check on by default?

### 4.3 Throwaway spikes: `scratch/cybs/` (git-ignored; outside the pnpm workspace globs; use **npm**)

```bash
mkdir -p scratch/cybs && cd scratch/cybs && npm init -y && npm i cybersource-rest-client@0.0.84 --save-exact
```

`scratch/cybs/cfg.cjs` reads env and never hard-codes secrets:
```js
module.exports = {
  authenticationType: 'jwt', jwtKeyType: 'SHARED_SECRET',          // verified: README + MerchantConfig.js (uppercased, checked)
  merchantID: process.env.CYBS_MERCHANT_ID, merchantKeyId: process.env.CYBS_KEY_ID,
  merchantsecretKey: process.env.CYBS_SECRET_KEY, runEnvironment: 'apitest.cybersource.com',
  logConfiguration: { enableLog: false },                           // verified: MerchantConfig reads result.logConfiguration;
};                                                                  // disabled → single silent Console transport (no file writes)
```

**How to instantiate** (verified in every `src/api/*Api.js` and in the samples): `const api = new cybs.PaymentsApi(cfg, apiClient)`. The constructor calls `apiClient.setConfiguration(cfg)`, which sets `apiClient.merchantConfig = new MerchantConfig(cfg)`.

**Write the spikes as one module, `scratch/cybs/service.cjs`, in the shape of `CybsService` (§5 T1),** so that T1 is a port, not a rewrite. Total budget about 60–70 min. All method signatures below are verified in the 0.0.84 source.

| Spike | Call | Record in PLAN §19 |
|---|---|---|
| **S1 combined first auth** (≈15 min) | `PaymentsApi.createPayment(body, cb)`. Scratch only: `paymentInformation.card:{number:'4111111111111111', expirationMonth:'12', expirationYear:'2031'}`. The body includes `processingInformation:{capture:false, commerceIndicator:'internet', actionList:['TOKEN_CREATE'], actionTokenTypes:['customer','paymentInstrument'], authorizationOptions:{initiator:{credentialStoredOnFile:true}}}`, `clientReferenceInformation:{code, transactionId: randomBytes(15).hex}`, a **minimal** `billTo:{firstName,lastName,postalCode,country:'US',email}` and `merchantInformation:{merchantDescriptor:{name:'TAB PARTNER VENUE'}}`. | `201 status:"AUTHORIZED"`; `id`; `tokenInformation.customer.id` / `.paymentInstrument.id`; which of `paymentAccountInformation.card` / `paymentInformation.card` holds `suffix,type` (log the **keys only**). If you get `MISSING_FIELD`/`INVALID_DATA`: (a) drop `merchantDescriptor`, retry; (b) add `billTo.address1, locality, administrativeArea` (the official samples send these), retry. Then send the same body with the same `code` again to see whether `DUPLICATE_REQUEST` fires. |
| **S2 capture** (≈5 min) | `CaptureApi.capturePayment(body, id, cb)`: **body first**. Then capture the same id again. | `201 status:"PENDING"` (or `TRANSMITTED`). Record the second-capture reason; the spec enum lists `EXCEEDS_AUTH_AMOUNT`, `TRANSACTION_ALREADY_SETTLED`, `DUPLICATE_REQUEST`. |
| **S3 reverse** (≈5 min) | New auth → `ReversalApi.authReversal(id, body, cb)`: **id first**. Body `{clientReferenceInformation:{code}, reversalInformation:{amountDetails:{totalAmount:'30.00', currency:'USD'}, reason:'test'}}`. Then reverse again. | `201 status:"REVERSED"`; the second call returns a 400 reason, expected `AUTH_ALREADY_REVERSED` |
| **S4 one-tap COF** (≈5 min) | Auth with `paymentInformation:{customer:{id}}` + `processingInformation.authorizationOptions.initiator:{type:'customer', storedCredentialUsed:true}`, no TOKEN_CREATE. The fields exist in the spec (`type` ∈ customer\|merchant). | AUTHORIZED, or the rejection reason (**UNVERIFIED** in sandbox) |
| **S5 timeout reversal** (≈10 min) | Auth with a known `transactionId`, then `ReversalApi.mitReversal(body, cb)` → `POST /pts/v2/reversals` with `{clientReferenceInformation:{code, transactionId}, reversalInformation:{amountDetails:{totalAmount}, reason}}` (shape from the official `timeout-reversal.js`). Then repeat with a transactionId that was **never sent**. | `201 REVERSED`; record the never-sent response exactly (**UNVERIFIED**; the sweep logic depends on it) |
| **S6 capture context + Microform** (≈20 min) | `new cybs.MicroformIntegrationApi(cfg, apiClient).generateCaptureContext({clientVersion:'v2', targetOrigins:['http://localhost:3001'], allowedCardNetworks:['VISA','MASTERCARD','AMEX'], allowedPaymentTypes:['CARD']}, cb)`. Verified: `accepts:['application/jwt']`, `returnType:'String'`, so `data` is the JWT. Decode with `JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())` and read `ctx[0].data.clientLibrary` and `ctx[0].data.clientLibraryIntegrity` (path verified in the official sample `app.js`). Serve a static HTML page on `localhost:3001` with the §5 T2 Microform code, tokenize 4111…, then auth with `tokenInformation:{transientTokenJwt}`. | Both values present; the auth is AUTHORIZED; brand/last4 location. The official sample uses an `http://localhost:3000` origin, so localhost should work (**UNVERIFIED**; the docs don't state it). The capture context is valid for 15 min (docs). |
| **S7 Ed25519** | Already run on Node 22.20.0: `generateKeyPairSync('ed25519')` → `crypto.sign(null, base, priv)` → `createPublicKey(priv).export({format:'jwk'})` = `{crv,x,kty}` → `crypto.verify(null, base, createPublicKey({key:jwk, format:'jwk'}), sig)` = true; a tampered base gives false. The signature is 64 bytes. | done |

Skip `CaptureContextParsingUtility.parseCaptureContextResponse` (it exists and is exported). It adds a public-key fetch to every page load, and we receive the JWT directly from Cybersource over TLS.

**SDK callback convention** (verified in `ApiClient.js` 0.0.84). The callback is `cb(error, data, response)`.

| Outcome | `error` | `status` present? |
|---|---|---|
| Success | `null`; `response = {status, header, text, req}` | yes, on `response` |
| HTTP 4xx (axios `ERR_BAD_REQUEST`) | `{status, response:{status, text: JSON-string, header, req:{method,url,headers}}}` | yes |
| HTTP 5xx | `{status, response:{…, req:{…, data, headers}}}` | yes |
| `ECONNREFUSED` / `ETIMEDOUT` | `{errno, code, syscall, address, port}` | **no** |
| Axios timeout (`ECONNABORTED`) or other network error | the raw axios error, with `code` | **no** |
| Response-decrypt failure | `new Error('Failed to decrypt response: …')` | **no** |

- The default `apiClient.timeout` is **60 000 ms**. Set it to 20 000.
- MLE is `optional` for createPayment, capture, reversal and getTransaction, and `false` for Microform sessions. We leave it off (the default).
- **Never log `error` or `response` whole.** `req.data` holds the request body (token or PAN) and `req.headers` holds the JWT auth header.

---

## 5. Step-by-step tasks (after the foundation at 6:00 PM)

Versions (PLAN §5, verified on the npm registry Sat 4:25 PM): `next@16.4.2`, `react@19.3.1`, `postgres@3.4.9`, `zod@4.6.7`, `vitest@5.0.5`, `tsx@4.23.15`, `typescript@6.0.3`, `cybersource-rest-client@0.0.84` (exact).

### T0 (6:00–6:10, 10 min): Pull and boot

1. Run `git pull && pnpm install && pnpm dev:venue` (port :3001).
2. Add the SDK: `cd apps/venue && pnpm add cybersource-rest-client@0.0.84 --save-exact`.
3. Make sure `apps/venue/next.config.ts` contains:
   ```ts
   import type { NextConfig } from 'next';
   const nextConfig: NextConfig = {
     serverExternalPackages: ['cybersource-rest-client'], // Next 16.4.2 docs: opts a dependency out of Server Component / Route Handler bundling (native require)
     transpilePackages: ['@tab/shared'],                   // only if the foundation ships TS source; use the real package name
     async headers() { return [{ source: '/pay/:path*', headers: [
       { key: 'Referrer-Policy', value: 'strict-origin' },   // the token path never leaks in Referer; origin is still sent (no-referrer could break Microform: UNVERIFIED)
       { key: 'Cache-Control', value: 'no-store' },
       { key: 'X-Robots-Tag', value: 'noindex' } ] }]; },
   };
   export default nextConfig;
   ```
   **Do not add a CSP.** It would block Microform's script and iframes unless tuned.
4. Set the Vercel env for `tab-venue` (Production) per PLAN §11, and mirror it in `apps/venue/.env.local`:
   - `VENUE_PUBLIC_URL`, `VENUE_PUBLIC_HOST`. Locally, `VENUE_PUBLIC_HOST=localhost:3001`: `@authority` includes a non-default port.
   - `DATABASE_URL`: transaction pooler `:6543`, role `tab_venue` or the single-role fallback.
   - `CYBS_MODE` (`mock` until the keys work), `CYBS_MERCHANT_ID`, `CYBS_KEY_ID`, `CYBS_SECRET_KEY`, `CYBS_RUN_ENV=apitest.cybersource.com`.
   - `TAP_KEY_DIRECTORY_JSON`, `AGENT_HOOK_URL`, `VENUE_HOOK_SECRET`, `VENUE_OPS_KEY`, `PAY_LINK_TTL_MIN` (see §3.3).
5. In `src/db/index.ts`: `export const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 5 })`. `prepare:false` is required on the transaction pooler (postgres.js README; PLAN §6).

### T1 (6:10–6:25, 15 min; a port of `scratch/cybs/service.cjs`): Cybersource service in `apps/venue/src/cybs/`

Docs:
- SDK: https://github.com/CyberSource/cybersource-rest-client-node
- Samples: https://github.com/CyberSource/cybersource-rest-samples-node/tree/master/Samples
  - `Payments/Payments/payment-with-flex-token-create-permanent-tms-token.js`
  - `cit-placing-credential-on-file.js`
  - `authorization-with-customer-token-id.js`
  - `authorization-for-timeout-reversal-flow.js`
  - `Payments/Capture/capture-payment.js`
  - `Payments/Reversal/process-authorization-reversal.js`
  - `timeout-reversal.js`
  - `TransactionDetails/retrieve-transaction.js`

Files:
- `types.d.ts`: `declare module 'cybersource-rest-client'` (the package ships no types).
- `config.ts`: the `cfg.cjs` config, built from env (`runEnvironment: process.env.CYBS_RUN_ENV`).
- `service.ts`: the interface below.
- `live.ts` and `mock.ts`, selected by `CYBS_MODE`.

```ts
export type CybsOutcome<T> =
  | { kind: 'ok'; http: number; data: T }
  | { kind: 'rejected'; http: number; body: unknown }       // definitive 4xx
  | { kind: 'unknown'; http: number | null; code?: string }; // 5xx/timeout/network/decrypt: NEVER blind-retry

export interface CybsService {
  captureContext(): Promise<{ jwt: string; clientLibrary: string; clientLibraryIntegrity: string }>;
  authorize(a: { code: string; transactionId: string; amountCents: number; billTo: BillTo;
                 transientTokenJwt?: string; saveCard: boolean; customerId?: string;
                 sandboxTestCard?: boolean }): Promise<CybsOutcome<AuthResp>>;
  capture(paymentId: string, code: string, amountCents: number): Promise<CybsOutcome<any>>;           // CaptureApi.capturePayment(body, id, cb)
  reverse(paymentId: string, code: string, amountCents: number, reason: string): Promise<CybsOutcome<any>>; // ReversalApi.authReversal(id, body, cb)
  timeoutReverse(code: string, origTransactionId: string, amountCents: number, reason: string): Promise<CybsOutcome<any>>; // ReversalApi.mitReversal(body, cb)
  getTransaction(id: string): Promise<CybsOutcome<any>>;     // TransactionDetailsApi.getTransaction(id, cb) → GET /tss/v2/transactions/{id}
}
```

The promise wrapper in `live.ts` classifies on `status` only (§4.3 table):
```ts
function invoke<T>(f: (cb: (e: any, d: T, r: any) => void) => void): Promise<CybsOutcome<T>> {
  return new Promise((resolve) => f((err, data, resp) => {
    if (!err) return resolve({ kind: 'ok', http: resp?.status ?? 201, data });
    const http: number | null = typeof err.status === 'number' ? err.status : null;
    if (http !== null && http < 500) return resolve({ kind: 'rejected', http, body: safeJson(err.response?.text) });
    resolve({ kind: 'unknown', http, code: err.code });       // never touch err.response.req
  }));
}
const client = () => { const c = new cybs.ApiClient(); c.timeout = 20_000; return c; };
// e.g. invoke(cb => new cybs.CaptureApi(cfg, client()).capturePayment(body, paymentId, cb))
```

**Authorization body.** Field paths are verified in the 0.0.84 spec and samples. `amount = (cents/100).toFixed(2)`. `customerId` is passed **only when there is no `transientTokenJwt`** (one-tap). "Use a different card" therefore always takes the Microform path.
```ts
const oneTap = !transientTokenJwt && !!customerId && !sandboxTestCard;
const save = saveCard && !oneTap;
{
  clientReferenceInformation: { code, transactionId },   // code `${shareId}-auth-${attempt}` (spec maxLength 59); transactionId 30 hex (maxLength 30)
  processingInformation: {
    capture: false,
    commerceIndicator: 'internet',                         // as in the official flex sample
    ...(save ? { actionList: ['TOKEN_CREATE'], actionTokenTypes: ['customer', 'paymentInstrument'],
                 authorizationOptions: { initiator: { credentialStoredOnFile: true } } } : {}),
    ...(oneTap ? { authorizationOptions: { initiator: { type: 'customer', storedCredentialUsed: true } } } : {}),
  },
  ...(transientTokenJwt ? { tokenInformation: { transientTokenJwt } } : {}),
  ...(oneTap ? { paymentInformation: { customer: { id: customerId } } } : {}),
  ...(sandboxTestCard ? { paymentInformation: { card: { number: '4111111111111111', expirationMonth: '12', expirationYear: '2031' } } } : {}),
  orderInformation: { amountDetails: { totalAmount: amount, currency: 'USD' },
                      billTo: { firstName, lastName, postalCode, country: 'US', email /* + address1, locality, administrativeArea if S1 required them */ } },
  merchantInformation: { merchantDescriptor: { name: 'TAB PARTNER VENUE' } },   // remove if S1 showed it is rejected
}
```
- `sandboxTestCard` is allowed only when `CYBS_RUN_ENV === 'apitest.cybersource.com'`. It throws otherwise.

**Response fields used** (spec 201 schema, verified):
- `id`; `status` ∈ `AUTHORIZED | PARTIAL_AUTHORIZED | AUTHORIZED_PENDING_REVIEW | AUTHORIZED_RISK_DECLINED | PENDING_AUTHENTICATION | PENDING_REVIEW | DECLINED | INVALID_REQUEST`; `errorInformation.{reason,message}`.
- `tokenInformation.customer.id` and `tokenInformation.paymentInstrument.id`.
- `paymentAccountInformation.card.{suffix,type}` and `paymentInformation.card.{suffix,type}` both exist in the schema. Which one is populated is **UNVERIFIED** (S1/S6).
- Fallback for Microform: the transient token's JWT payload `data.number` (masked, e.g. `411111XXXXXX1111`) and `data.type`. This was seen in a sample token of format `mf-0.11.0`; the v2 shape is **UNVERIFIED**.
- Card type codes: `001` Visa, `002` Mastercard, `003` Amex.

**`classifyAuth` (pure)** maps an outcome to the next state and any reversal:

| Outcome | Next state | Reversal |
|---|---|---|
| `ok` + `AUTHORIZED` | AUTHORIZED | none |
| `ok` + `PARTIAL_AUTHORIZED`, `AUTHORIZED_PENDING_REVIEW`, `AUTHORIZED_RISK_DECLINED` or `PENDING_REVIEW`, with an `id` (these may hold funds) | DECLINED if the reversal is `REVERSED` or `AUTH_ALREADY_REVERSED`; AUTH_UNKNOWN on any other reversal outcome (the sweep then timeout-reverses by `transactionId`) | `authReversal` |
| `ok` + `DECLINED`, `INVALID_REQUEST` or `PENDING_AUTHENTICATION`, or no `id`; or `rejected` | DECLINED | none |
| `unknown` | AUTH_UNKNOWN | none |

We never request partial auth.

**Other calls:**
- **Capture body:** `{clientReferenceInformation:{code:`${shareId}-capture-${n}`}, orderInformation:{amountDetails:{totalAmount, currency:'USD'}}}`. Success = 201 with `status` `PENDING` or `TRANSMITTED` (spec enum).
- **Reverse body:** `{clientReferenceInformation:{code:`${shareId}-reverse-${n}`}, reversalInformation:{amountDetails:{totalAmount, currency:'USD'}, reason}}`. The amount equals the authorized amount. Success = `REVERSED`.
- **Timeout reverse body:** `{clientReferenceInformation:{code:`${shareId}-timeout_reverse-${n}`, transactionId: <original auth transaction_id>}, reversalInformation:{amountDetails:{totalAmount}, reason}}`.
- **Mock:** deterministic ids (`mock_` + random). The outcome comes from mock-only `bill_to.first_name`: `"decline"` → DECLINED, `"timeout"` → unknown, anything else → AUTHORIZED.

**Persistence rule (M6), around every call:**
1. INSERT `venue.payment_ops(share_id, op, attempt, client_ref_code, transaction_id, status:'sent')` **before** the call. The unique `(share_id, op, attempt)` blocks double-sends.
2. After the call, UPDATE the row with `cybs_id`, `status` and `http_status`.
3. `response` gets a redacted subset only: `{id, status, errorInformation:{reason}, tokenInformation:{customer:{id}, paymentInstrument:{id}}}`.

### T2 (6:25–6:45, 20 min, then the gate): Pay page minimum on production

Docs:
- Client setup: https://developer.cybersource.com/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept-flex/microform-integ-v2/micro-getting-started-pay-card/micro-getting-started-pay-card-cs-setup.html
- Server context: …/micro-getting-started-pay-card-ss-setup/creating-server-side-context-v2-card.html (valid 15 min; hard-code `targetOrigins` server-side)
- Sample: https://github.com/CyberSource/cybersource-flex-samples-node/tree/master/express-microform

**Steps:**
- `scripts/seed-test-share.ts`: inserts one order + one $1.00 share for `payer_ref` `'0'.repeat(31)+'1'` and prints `VENUE_PUBLIC_URL/pay/<token>`. It uses the T4 `ids.ts` / `token.ts`. Write those two tiny files now.
- `app/pay/[token]/page.tsx` (server component; `params: Promise<{token:string}>`, so `await` it). Call `await connection()` from `next/server` first. This replaces `dynamic='force-dynamic'`, which Next 16 removes when Cache Components is on. Then:
  1. Hash the token.
  2. Load the share and order. **GET never consumes the token.**
  3. Pick a state (T6).
  4. Ready state only: call `cybs.captureContext()` **on every load**, with `targetOrigins = [VENUE_PUBLIC_URL]` as a server constant.
  5. Render `<PayForm …/>`.
- `app/pay/[token]/PayForm.tsx` (`'use client'`). The API below is verbatim from the official sample `views/index.ejs`:
  ```ts
  const s = document.createElement('script');
  s.src = clientLibrary; s.integrity = clientLibraryIntegrity; s.crossOrigin = 'anonymous'; s.async = true;
  s.onload = () => {
    try {
      const flex = new (window as any).Flex(captureContextJwt);
      const microform = flex.microform('card', { styles: { input: { 'font-size': '16px' } } }); // ≥16px: no iOS zoom
      microform.createField('number', { placeholder: 'Card number' }).load('#cc-number');
      microform.createField('securityCode', { placeholder: 'CVC' }).load('#cc-cvc');
      microformRef.current = microform;
    } catch { setState('form_failed'); }
  };
  s.onerror = () => setState('form_failed');
  document.head.appendChild(s);
  // on "Hold $30.00":
  microformRef.current.createToken({ expirationMonth: mm, expirationYear: yyyy }, (err: any, transientToken: string) => {
    if (err) return setFieldError(err.message);
    fetch(`/api/pay/${encodeURIComponent(payToken)}/authorize`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transientTokenJwt: transientToken, save_card: saveCard, bill_to }) })
      .then(r => r.json()).then(applyResult);
  });
  ```
  Microform v2 has no expiry field. Use two `<select>`s (MM, YYYY), as in the sample.

**6:45 gate:** load the seeded link on **an iPhone** at the production URL. Enter 4111 1111 1111 1111, any future expiry, any 3-digit CVC, and expect "Held".
- **Fallback if this fails:** a button labelled **"Use sandbox test card (Visa 4111) — no card entry"**.
  - It calls `authorize({ sandboxTestCard: true })` server-side.
  - It is rendered only when `CYBS_RUN_ENV==='apitest.cybersource.com'`.
  - Human-typed card data still never touches our servers.

### T3 (6:45–7:45, 60 min): TAP core in `packages/shared/src/tap.ts` + the venue verifier

**Spec facts** (developer.visa.com TAP spec, re-read Sat; RFC 9421):
- Required: `@authority`, `@path`, `created`, `expires`, `keyid`, `alg`, `nonce`, `tag`.
- Tags: `agent-browser-auth` or `agent-payer-auth`.
- Timestamps "should not be more than 8 minutes apart"; created in the past; expires in the future.
- Nonces are recorded for 8 minutes.
- The key is located by keyid. Block the request if the key can't be retrieved or the signature fails.
- "An Agent or a Payment Scheme may optionally define additional fields." `@method` + `content-digest` are **our declared extension**.
- The spec examples use label `sig2` and `alg="Ed25519"`. RFC 9421 registers `ed25519`, so we sign lowercase and accept either case.
- One spec example spells `keyId`. We follow RFC 9421 and require `keyid`.
- Visa's real directory returns RSA-style JWKs (`n`, `e`). Our mock returns OKP: say "mock".

**`packages/shared/src/tap.ts`** (pure; used by signer and verifier; `import { createHash } from 'node:crypto'`):
```ts
export const TAG = { browse: 'agent-browser-auth', pay: 'agent-payer-auth' } as const;
export const MAX_WINDOW_S = 480, SIGN_TTL_S = 120, LABEL = 'sig2';
export function canonicalConsent(c: ConsentSet): string {        // PLAN §8: exact body bytes
  const shares = [...c.shares].sort((a, b) => (a.share_id < b.share_id ? -1 : a.share_id > b.share_id ? 1 : 0))
    .map(s => ({ share_id: s.share_id, cybs_payment_id: s.cybs_payment_id, amount_cents: s.amount_cents }));
  return JSON.stringify({ order_id: c.order_id, total_cents: c.total_cents, shares });
}
export function consentFromOrder(o: OrderStatus): ConsentSet {   // agent-side builder; never hand-build
  return { order_id: o.order_id, total_cents: o.total_cents, shares: o.shares.map(s => {
    if (!s.cybs_payment_id) throw new Error(`share ${s.share_id} has no cybs_payment_id`);
    return { share_id: s.share_id, cybs_payment_id: s.cybs_payment_id, amount_cents: s.amount_cents }; }) };
}
export const contentDigest = (body: Uint8Array) =>
  `sha-256=:${createHash('sha256').update(body).digest('base64')}:`;              // RFC 9530 syntax (verified)
export function signatureParams(components: string[], p: { created: number; expires: number; keyid: string; nonce: string; tag: string }) {
  return `(${components.map(c => `"${c}"`).join(' ')});created=${p.created};expires=${p.expires};keyid="${p.keyid}";alg="ed25519";nonce="${p.nonce}";tag="${p.tag}"`;
}
export function signatureBase(components: string[], v: { method: string; authority: string; path: string; contentDigest?: string }, params: string) {
  const line = (c: string) => c === '@method' ? `"@method": ${v.method.toUpperCase()}`
    : c === '@authority' ? `"@authority": ${v.authority.toLowerCase()}`
    : c === '@path' ? `"@path": ${v.path}`
    : c === 'content-digest' ? `"content-digest": ${v.contentDigest}` : (() => { throw new Error(`unsupported component ${c}`); })();
  return [...components.map(line), `"@signature-params": ${params}`].join('\n');   // LF-joined, no trailing LF (RFC 9421 §2.5)
}
export function parseSignatureInput(h: string): { label: string; raw: string; components: string[]; params: Record<string, string | number> } | null
// strict: exactly one `label=(...)` member; components = quoted tokens; params = ;k=int | ;k="string"; raw = bytes after "label="
export function parseSignature(h: string, label: string): Buffer | null   // `label=:<base64>:`
export const routeTag = (method: string) => (method === 'GET' ? TAG.browse : TAG.pay);
export const requiredComponents = (method: string) =>
  method === 'GET' ? ['@method', '@authority', '@path'] : ['@method', '@authority', '@path', 'content-digest'];
```

**Venue verifier `apps/venue/src/tap/verify.ts`** (a pure core plus an injected nonce store):
```ts
type Deps = { now: () => number; authority: string /* VENUE_PUBLIC_HOST, never the Host header */;
  keys: Record<string, JsonWebKey>; nonces: { seen(n: string): Promise<boolean>; record(n: string): Promise<boolean> } };
export async function verifyTap(req: { method: string; path: string; headers: Headers; body: Uint8Array }, d: Deps): Promise<TapVerifyReport>
```

`TapStep.name` values come from the PLAN enum. **Stop at the first failure.** `steps` lists only the steps that ran; the panel greys the rest.

| n | name | Pass condition | Fail `detail` example |
|---|---|---|---|
| 1 | `tag` | `tag` ∈ {browse, pay} **and** equals `routeTag(method)` | `tag agent-browser-auth not allowed on POST /checkout/…` |
| 2 | `params` | created, expires, keyid, alg, nonce, tag all present; `alg.toLowerCase()==='ed25519'`; components ⊇ `requiredComponents(method)` | `missing content-digest` |
| 3 | `timestamps` | `created ≤ now+5` (skew), `expires > now`, `expires − created ≤ 480` | `expired 312s ago` |
| 4 | `nonce` | `!await nonces.seen(nonce)` | `nonce replayed (seen 41s ago)` |
| 5 | `key` | `keys[keyid]` exists → `createPublicKey({key, format:'jwk'})` | `unknown keyid tab-agent-x` |
| 6 | `signature` | If `content-digest` is covered, the recomputed `contentDigest(body)` must **equal** the header. Then `crypto.verify(null, Buffer.from(base), pub, sig)`. Then `await nonces.record(nonce)` must return true (a lost race counts as a replay). The nonce is recorded only after a valid signature, so junk requests can't burn nonces. | `content-digest mismatch: body changed after signing` |

- The report also carries `signature_base` (public data only), `route`, `tag`, `accepted`, `reason`, and `business:null` (filled in by checkout).
- Nonce store = `venue.tap_nonces`:
  - `seen`: `select seen_at from venue.tap_nonces where nonce=$1 and seen_at > now()-interval '8 min'`.
  - `record`: `insert … on conflict do nothing returning nonce`.
- `withTap(handler)` (`src/tap/withTap.ts`):
  1. `const body = Buffer.from(await req.arrayBuffer())`.
  2. `verifyTap` with `path = new URL(req.url).pathname`.
  3. On failure → 401 with the report (checkout wraps it in `CommitResult`). On success → `handler(req, ctx, {body, report})`.

**Unit tests `apps/venue/test/tap.verify.test.ts` (M8):**
- valid GET (browse)
- valid POST (pay)
- tampered body → step 6 digest
- replay → step 4
- expired → step 3
- window > 8 min → step 3
- wrong tag on POST → step 1
- missing nonce → step 2
- unknown keyid → step 5
- bad signature bytes → step 6
- `alg="Ed25519"` accepted

Use an in-memory nonce store and a test keypair. Also test that `canonicalConsent` sorts and is byte-exact.

**Keygen** `apps/agent/src/tap/keygen.ts` (run once; output to the password manager, never git):
```ts
const { privateKey } = generateKeyPairSync('ed25519');
const kid = process.env.TAP_KEY_ID ?? 'tab-agent-ed25519-1';
console.log('TAP_PRIVATE_KEY_PEM_B64=' + Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64'));
console.log('TAP_KEY_DIRECTORY_JSON=' + JSON.stringify({ [kid]: createPublicKey(privateKey).export({ format: 'jwk' }) }));
```

### T4 (7:45–8:45, 60 min): Venue API routes

All routes are under `apps/venue/app`. `runtime` defaults to `'nodejs'` (Next 16.4.2 docs), so no export is needed. `params` is a Promise.

**Helpers:**

| File | Notes |
|---|---|
| `src/ids.ts` | `ord_` / `shr_` + 10, `evt_` + 16 chars of `abcdefghijklmnopqrstuvwxyz234567` from `randomBytes` |
| `src/token.ts` | `randomBytes(16).toString('base64url')` (128 bit, 22 chars); `token_hash = sha256(token)` as a Buffer (postgres.js sends a Buffer as bytea) |
| `src/outbox.ts` | `enqueue(tx, VenueEvent)` in the same transaction as the state change (the event_id is generated here); `deliver(ids)` |
| `src/pricing-bridge.ts` | Calls `priceBundle(bundle)` from `@tab/shared` |

`deliver(ids)` POSTs the stored JSON to `AGENT_HOOK_URL` with these headers and options:
- `X-Tab-Timestamp: <unix s>`
- `X-Tab-Signature: sha256=` + `createHmac('sha256', VENUE_HOOK_SECRET).update(ts + '.' + body).digest('hex')`
- `AbortSignal.timeout(3000)`

It then sets `delivered_at`, or `attempts+1`. Handlers `await deliver(...)` after commit; the sweep redelivers anything left over.

**Routes:**

| Route | Logic |
|---|---|
| `keys/[keyid]/route.ts` GET | `TAP_KEY_DIRECTORY_JSON[keyid]` → `{...jwk, kid, note:'mock Visa key directory (hackathon)'}`; 404 otherwise. No TAP. |
| `availability/[bundleKey]/route.ts` GET (`withTap`) | `{available: /^bnd_[0-9a-f]{10}$/.test(key)}`. Honest stub: the demo merchant always has stock. |
| `orders/route.ts` POST (`withTap`) | See the steps below |
| `orders/[orderId]/route.ts` GET (`withTap`) | → `OrderStatus` (shares: `share_id, payer_ref, amount_cents, status, cybs_payment_id, card_last4`; **no tokens or URLs**) |
| `orders/[orderId]/cancel/route.ts` POST (`withTap`, `maxDuration = 120`) | See the steps below |
| `page.tsx` `/` | Static: "Tab Partner Venue (sandbox merchant of record) — prepaid dinner + show bundles, booked through Tab. Demo merchant; payments run on the Cybersource sandbox." No real brands. |

**`POST /orders`:**
1. `CreateOrderRequest.parse(JSON.parse(body.toString('utf8')))`. Strict zod rejects extra fields such as amounts.
2. Validate: `payer_refs.length === party_size`, unique, and `now < deadline_at ≤ now+7d`.
3. Price:
   - `pp = priceBundle(bundle)`.
   - Dinner unit = `round(dinner.est_high_pp_usd*100*(1+TAX+TIP))`; show unit = `pp − dinner unit`; `qty = party_size`.
   - Total = `pp × party_size` (M3: computed here, never taken from the body).
4. In one transaction:
   - Insert the order. On a `unique (plan_ref, plan_version)` conflict: if the existing order is OPEN **and every share is PENDING**, rotate all its tokens and return it (a safe retry). Otherwise return 409 with the current `OrderStatus`.
   - Insert N shares with `amount_cents = pp` and `token_expires_at = least(now() + PAY_LINK_TTL_MIN min, deadline_at)`.
5. Respond 201 `CreateOrderResponse` with `pay_url = VENUE_PUBLIC_URL + '/pay/' + token`.

**`POST /orders/{id}/cancel`:**
1. In a transaction: `update venue.orders set status='CANCELLING', updated_at=now() where id=$1 and status='OPEN' returning *`. Only the caller that gets the row proceeds; others return the current `OrderStatus`.
2. PENDING → `VOID` (token dead).
3. AUTHORIZED → `REVERSING` (committed) → `reverse(...)`:
   - `REVERSED` or `AUTH_ALREADY_REVERSED` → `RELEASED` + `share.released{retry:false}`.
   - Anything else → stays REVERSING for the sweep.
4. AUTHORIZING / AUTH_UNKNOWN shares are left to the authorize handler / sweep.
5. When every share is in {VOID, RELEASED, DECLINED}: order `CANCELLED` + `order.cancelled`.

### T5 (8:45–9:30, 45 min): Agent side: signer and the real `VenuePort` (`apps/agent/src/tap`, `src/venueClient`)

```ts
// src/tap/signer.ts
const priv = createPrivateKey(Buffer.from(env.TAP_PRIVATE_KEY_PEM_B64, 'base64').toString('utf8'));
export function sign(method: 'GET' | 'POST', url: URL, body: Uint8Array | null,
  o: { tag?: string; created?: number; expires?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const created = o.created ?? now, expires = o.expires ?? now + SIGN_TTL_S;
  const components = requiredComponents(method);
  const digest = body ? contentDigest(body) : undefined;
  const params = signatureParams(components, { created, expires, keyid: env.TAP_KEY_ID,
    nonce: randomBytes(32).toString('base64'), tag: o.tag ?? routeTag(method) });
  const base = signatureBase(components, { method, authority: url.host, path: url.pathname, contentDigest: digest }, params);
  const sig = cryptoSign(null, Buffer.from(base), priv).toString('base64');
  return { 'Signature-Input': `${LABEL}=${params}`, Signature: `${LABEL}=:${sig}:`, ...(digest ? { 'Content-Digest': digest } : {}) };
}
```

**`src/venueClient/index.ts` implements `VenuePort` (PLAN §9).** On every call it:
- builds the URL from `VENUE_BASE_URL`, which must be the venue's production origin (= the venue's `VENUE_PUBLIC_URL`); `@authority` = `new URL(VENUE_BASE_URL).host`;
- sends `content-type: application/json` on POSTs;
- uses `AbortSignal.timeout(30_000)`, or **90 000** for `commit` and `cancel`, since they run several sequential Cybersource calls;
- zod-parses the response.

**`commit(orderId, consent, test?)`:**
1. `body = Buffer.from(canonicalConsent(consent))`.
2. Sign the body.
3. Apply the test variant:

   | `test` | What is sent | Expected rejection |
   |---|---|---|
   | `tamper` | `canonicalConsent({...consent, shares:[{…first, amount_cents: first.amount_cents + 100}, …rest]})` with the **original** headers | step 6 (digest) |
   | `expired` | `created=now-600, expires=now-480` | step 3 |
   | `wrong_tag` | `tag:'agent-browser-auth'` | step 1 |
   | `replay` | the identical request sent twice; return the **second** result | step 4 |

4. Parse `CommitResult` from 200 / 401 / 409.
5. Emit SSE `tap.signed {order_id, method:'POST', path, signature_input, signature_short: sig.slice(0,16)+'…'}` and `tap.verify {order_id, report}`.

**Replay safety:** `tapTest.ts` refuses `replay` while the order is OPEN with all shares AUTHORIZED, because the first leg would capture. In every other state the first leg is a no-op: the business check fails, or the order is CAPTURED and the idempotent path makes no Cybersource call.

**Timeout safety:** on a network timeout during `commit`, call `getOrder`. OPEN → retry once with a fresh signature (safe: row lock + conditional UPDATE, T7). COMMITTING/CAPTURED → throw `CommitPendingError` (A waits for `order.captured`). Never retry more than once.

**`src/venueClient/hook.ts`** exports `verifyVenueHook(rawBody: string, headers: Headers): VenueEvent | null` (null on any failure). A's route must pass `await c.req.text()`; the HMAC covers raw bytes, never re-serialized JSON. It:
1. checks `|now − ts| ≤ 300`;
2. compares the HMAC with `timingSafeEqual` on equal-length buffers;
3. runs `VenueEvent.parse(JSON.parse(rawBody))`;
4. returns the event. A dedupes it on `inbound_events('venue', event_id)` and dispatches it.

**`src/venueClient/ledger.ts`:** exports `emitLedger(ev)` and `emitCounters()`; A calls them from its hook dispatch and transitions. For each `VenueEvent`:
- Map `payer_ref` → `app.users.payer_ref` → `app.participants.lane`.
- Emit SSE `ledger {order_id, lane, status, amount_cents, cybs_id_short:'…'+id.slice(-8)}`.
- Emit `counters`, computed from the DB so restarts don't zero them:
  - `groups_converted = select count(*) from app.plans where state='CONFIRMED'`;
  - `fronted_by_individual_cents: 0`;
  - `holds_released = select count(*) from app.events where type='ledger' and data->>'status'='RELEASED'`.
- **Never** put `pay_url` into any event.

**`src/venueClient/sweep.ts`:** `callVenueSweep()` → `POST /ops/sweep`, Bearer `VENUE_OPS_KEY`. A schedules it as a due_job every 30 s.

**Secrets:** `fly secrets set -a tab-agent VENUE_MODE=live VENUE_BASE_URL=… TAP_KEY_ID=… TAP_PRIVATE_KEY_PEM_B64=… VENUE_HOOK_SECRET=… VENUE_OPS_KEY=…`. The values come out-of-band from the password manager.

### T6 (9:30–10:30, 60 min): Authorize route and the 7 pay-page states

**`app/api/pay/[token]/authorize/route.ts`** (POST; `export const maxDuration = 60`):
1. Zod-validate `{transientTokenJwt?: string, save_card: boolean, bill_to: {first_name, last_name, postal_code, email?}}`. Add `address1, locality, administrativeArea` if S1 required them.
2. **Consume the token atomically.** No row → return the page state for the current status.
   ```sql
   update venue.shares s set token_used_at=now(), status='AUTHORIZING', updated_at=now()
   from venue.orders o where s.order_id=o.id and s.token_hash=$1 and s.token_used_at is null
     and s.token_expires_at>now() and s.status='PENDING' and o.status='OPEN' and o.deadline_at>now()
   returning s.*, o.deadline_at
   ```
3. Set `attempt = 1 + count(payment_ops where share_id=$1 and op='auth')`. Insert the payment_ops row (`code = shareId-auth-attempt`, `transactionId = randomBytes(15).toString('hex')`). Outbox `share.authorizing`.
4. Look up `customer = venue.customers[payer_ref]`. If there is no `transientTokenJwt`, no customer and no sandbox fallback → 400.
5. Call `cybs.authorize(...)` (T1 body; one-tap only when there is no transient token). The amount is `share.amount_cents` from the DB.
6. Act on the classified outcome:
   - **AUTHORIZED:** re-read the order in a transaction.
     - If it is not OPEN: reverse immediately → `RELEASED` → state `cancelled`.
     - Otherwise: share AUTHORIZED; set `cybs_payment_id` and brand/last4; if `save_card` and TOKEN_CREATE returned ids, upsert `venue.customers`; outbox `share.authorized` → `{state:'held', card}`.
   - **DECLINED:** rotate the token (new `token_hash`, `token_used_at=null`, new `token_expires_at`, status `PENDING`); outbox `share.declined{pay_url, expires_at}` → `{state:'declined', retry_url}`.
   - **AUTH_UNKNOWN:** share `AUTH_UNKNOWN`; outbox `share.auth_unknown` → `{state:'unconfirmed'}`. The sweep reverses it and issues a fresh link.

**The 7 states.** The server picks one; `PayForm` handles the transitions. The copy is final and the M9 lint applies.

| # | State | When | Primary copy |
|---|---|---|---|
| 1 | **Ready** | PENDING, token valid | Header: "Tab Partner Venue · sandbox merchant of record". "Prepaid dinner + show bundle · {date} · dinner {time} · show {time} · party of {n}". Big **"$30.00"**. "This is a hold. It's charged only if everyone's in by {deadline}; otherwise it's released." Microform fields + MM/YYYY + name + ZIP. Unchecked ☐ "Save this card with Tab Partner Venue for one-tap holds next time (stored as a Cybersource token)". Button **"Hold $30.00"**. **Saved-card variant:** "Hold $30.00 on Visa ••1111" + "Use a different card". A processing overlay shows during auth. |
| 2 | **Held** | after AUTHORIZED | "Held $30.00 on Visa ••1111. Not charged yet. You'll get a text when everyone's in." |
| 3 | **Declined** | DECLINED | "That card didn't go through. Only you see this." Button "Try another card" → `retry_url` |
| 4 | **Expired / used** | no row, expired or consumed | "This link has expired or was already used. Text Tab for a fresh one." |
| 5 | **Already held / booked** | AUTHORIZED / CAPTURING / CAPTURED | "Your hold is in place." / CAPTURED: "Everyone's in. Charged $30.00." |
| 6 | **Cancelled** | order CANCELLING/CANCELLED, share VOID/RELEASED | "Plan cancelled. Nobody was charged; your pending authorization was released." |
| 7 | **Something went wrong** | (a) script `onerror`, `new Flex` throws, or capture-context error; (b) `unconfirmed` (AUTH_UNKNOWN) | (a) "The secure card form didn't load. Reload to try again." Button "Reload". (b) "We couldn't confirm your hold. Nothing has been charged. You'll get a fresh link in about a minute." |

UI rules (apply `vercel-react-best-practices`, `vercel-composition-patterns` and `web-design-guidelines` to every pay-page change):
- Server-render the header and amount.
- Tabular figures.
- 44 px tap targets; ≥16 px inputs.
- `aria-live` on state changes.
- One primary button.
- No other people's names or counts.

### T7 (10:30–11:00, 30 min): Checkout (capture-all)

**`app/checkout/[orderId]/route.ts`** (POST, `withTap`, `export const maxDuration = 120`; four sequential captures can take up to 4 × 20 s):
1. TAP failure → 401 `CommitResult{result:'rejected', tap, captures:[]}`.
2. In a transaction: `select … for update` on the order and its shares. Rebuild the consent set from the DB and compute `consent_matches = body.equals(Buffer.from(canonicalConsent(rebuilt)))` (byte-exact, M4).
   - Order `CAPTURED` and `consent_matches` → 200 `captured`, built from the DB with no Cybersource call (idempotent retry).
   - Order not `OPEN` → 409 `rejected`.
   - Business checks:
     - `all_authorized`: every share AUTHORIZED with `cybs_payment_id` not null;
     - `sum_matches`: Σ `amount_cents` = `total_cents`;
     - `consent_matches`.
     Any false → 409 `rejected`; the order stays OPEN; **nothing is captured**.
   - `update venue.orders set status='COMMITTING', updated_at=now() where id=$1 and status='OPEN' returning id` (M5; the row lock already serializes, this is belt and braces).
3. **After the transaction**, loop over the shares sorted by `share_id`:
   - Insert the `capture` attempt-1 payment_ops row → share CAPTURING → `cybs.capture`.
   - `ok` → CAPTURED + outbox `share.captured`.
   - `rejected` / `unknown` → **stop; never retry.** Order `NEEDS_ATTENTION` + `order.needs_attention`. Result `partial` if at least one share was captured, else `rejected`.
4. All captured → order `CAPTURED` + `order.captured` → 200 `{result:'captured', tap (with business), captures}`.

**11:00 checkpoint (§7).** The same flow runs locally with `CYBS_MODE=mock` through `scripts/agent-sim.ts` (§6).

### 11 PM–4 AM tasks

| # | Time | Task | Files |
|---|---|---|---|
| T8 | 45 min | Negative TAP modes end to end. `tapTest.ts` (`runTapTest(kind, orderId)`; A passes the most recent plan's `venue_order_id`): `getOrder` → `consentFromOrder` → commit with `test`. A wires it at `POST /ops/tap-test {kind}`. Check each mode lands on its expected step on the live venue. | `src/venueClient/tapTest.ts` |
| T9 | 45 min | `app/ops/sweep/route.ts` (Bearer `VENUE_OPS_KEY`, constant-time compare, `maxDuration = 120`). Every action is a conditional UPDATE, so overlapping sweeps are safe. Actions listed below the table. | `apps/venue/app/ops/sweep/route.ts`, `src/sweep.ts` |
| T10 | 30 min | NEEDS_ATTENTION path: a console flag (data only) and `scripts/check-share.ts <shareId>` → `getTransaction(cybs_payment_id)` → print the status. **Never auto-retry a capture.** | `scripts/check-share.ts` |
| T11 | 30 min | `ledger.ts` + `counters` with B watching the console. Confirm `cybs_id_short` shows real sandbox IDs. | `src/venueClient/ledger.ts` |
| T12 | 60 min | Pay-page polish: all 7 states on a phone, saved-card one-tap, error copy, loading skeleton. | `app/pay/**` |
| T13 | 30 min | Repo-wide tests (M1, M2, M6), then `pnpm test && pnpm typecheck`. | `apps/venue/test/*` |
| T14 | 30 min | Visa beat rehearsal with A and B: Tamper, then "I'm out" → RELEASED. | — |

T9 sweep actions:
- **(a)** AUTHORIZING with `updated_at < now()-90s` (the function died) → AUTH_UNKNOWN.
- **(b)** AUTH_UNKNOWN with `updated_at < now()-60s` → TIMEOUT_REVERSING → `timeoutReverse` with the auth row's `transaction_id`. The new payment_ops row (`op timeout_reverse`) gets its own unique `transaction_id`; the request carries the original one. Then:
  - `REVERSED`, or a definitive 4xx (meaning per S5 must be confirmed) → RELEASED. If the order is OPEN: new token → PENDING + `share.released{retry:true, pay_url, expires_at}`. Otherwise `retry:false`.
  - Unknown → stay; retry on the next sweep.
- **(c)** OPEN orders past `deadline_at` → the cancel logic (reverse all).
- **(d)** CANCELLING orders → finish them.
- **(e)** AUTHORIZED shares on CANCELLING/CANCELLED orders, and REVERSING shares with `updated_at < now()-60s` → reverse (`AUTH_ALREADY_REVERSED` counts as RELEASED).
- **(f)** COMMITTING orders older than 2 min → NEEDS_ATTENTION.
- **(g)** Outbox rows with `delivered_at is null and attempts < 20` → deliver.
- **(h)** `delete from venue.tap_nonces where seen_at < now()-interval '8 min'`.

### 4 AM–11:30 AM

- **Rest 4:00–5:30.**
- **5:30–7:00:**
  - Pay-page polish.
  - Optional OG image: `app/opengraph-image.tsx` with `ImageResponse` from `next/og` (Next 16.4.2 docs), reading "Tab Partner Venue · secure hold". **No amount, no budget.**
  - Screenshot the Business Center transaction search (auth, capture and reversal rows) for the Devpost.
  - Check `merchantDescriptor`.
- **7:00 freeze.**
- **7:00–9:30:**
  - Verify the ledger and TAP shots for B's video.
  - Give B the Devpost Visa paragraph (PLAN §2.3 table, condensed) and the production-path line: ICC `/icc/v1/agents` registry, `/icc/v1/instructions` mandates, 3DS, network tokens.
- **9:30–11:30:** rehearse the table version ×5 and the stage version ×5; Q&A drill.
- **11:30:** no deploys.

---

## 6. Mocks until teammates deliver, and switching to real

| Missing piece | Use | Switch to real |
|---|---|---|
| Cybersource keys / sandbox not active | `CYBS_MODE=mock` (T1 `mock.ts`). The pay page skips Microform and shows "Mock hold (no card)". Outcomes come from `first_name` `decline` / `timeout`. | `CYBS_MODE=live` + keys in Vercel env; redeploy |
| A's agent not calling the venue yet | `apps/venue/scripts/agent-sim.ts` (tsx). It uses the shared `tap.ts` + a local test key to: create an order for 2–4 fake 32-hex `payer_ref`s, print pay URLs, poll `GET /orders/{id}`, `commit` (plus each test mode) and `cancel`. Locally, point `TAP_KEY_DIRECTORY_JSON` at the sim key. | A calls `VenuePort` with `VENUE_MODE=live` |
| Agent `/venue/hook` not mounted | `scripts/hook-echo.ts`: a Node HTTP server on :8090 that verifies the HMAC and prints `VenueEvent`s; `AGENT_HOOK_URL=http://localhost:8090` | `AGENT_HOOK_URL=https://tab-agent.fly.dev/venue/hook` |
| Agent side before the venue is live | The foundation's in-memory mock `VenuePort` (`VENUE_MODE=mock`) | `VENUE_MODE=live` + `VENUE_BASE_URL` + `TAP_*` Fly secrets |
| B's console / TAP panel | `curl -N "$AGENT/events?k=$CONSOLE_KEY"` to watch `tap.*`, `ledger` and `counters` | B's `/console` |
| Real Scout bundles | A hand-written `VenueBundle` in `agent-sim.ts` | A passes the winning bundle |

---

## 7. Integration checkpoints

| Time | With | Must work |
|---|---|---|
| **6:00 F** | all | Foundation pulled; `pnpm dev:venue` boots; `002_venue.sql` applied; shared contracts compile in the venue |
| **6:45 go/no-go** | all | A real sandbox hold from **an iPhone** on the production venue URL (else the labelled test-card fallback). Booth answers recorded. With A, settle: `pay_url` persistence for `T_REPING`; `PAY_LINK_TTL_MIN` vs. the approval window; the `payer_ref` length. (Settled: A mounts `/venue/hook` and `/ops/tap-test` in `src/plan/register.ts`; C mounts nothing in the agent except via `src/venueClient/register.ts` if needed.) |
| **9:30 PM** | — | C alone: `scripts/agent-sim.ts` with the agent's real `VenuePort` (`checkAvailability` → `createOrder` → `getOrder`) passes TAP on the live venue; `hook-echo.ts` verifies HMAC. |
| **10:30 PM** | A | `VENUE_MODE=live` on Fly: A's `create_order` gets `pay_url`s; signed `share.*` hooks reach `/venue/hook`. Sweep due_job by 11:45. |
| **11:00 PM checkpoint 1** | all | On 2 real phones: join → cached options → ballot → **sandbox hold** → TAP commit → **capture**, with real Cybersource IDs in `GET /orders/{id}`. If red, all 3 swarm it. |
| **~1:30 AM** | B | TAP panel: a valid commit shows 6 ✓; Tamper → step 6; Replay → step 4; Expired → step 3; Wrong tag → step 1; ledger lanes and counters live |
| **4:00 AM checkpoint 2** | all | 4 phones (≥1 non-team); 3 clean runs in a row; "I'm out" → all RELEASED; Reset leaves no live sandbox holds (cancel + sweep reverse) |
| **7:00 freeze** | all | Bug fixes only |

---

## 8. Verification

**Unit tests (vitest; `pnpm test`):**

| Test (PLAN §4) | File | Asserts |
|---|---|---|
| M8 | `apps/venue/test/tap.verify.test.ts` | The T3 list |
| M4 | `apps/venue/test/checkout.allornothing.test.ts` | Pure `decideCommit(order, shares, body)`: one PENDING share → reject; Σ≠total → reject; re-ordered keys or shares, or a $1 change → `consent_matches:false`; exact canonical bytes → accept; CAPTURED + matching body → idempotent `captured` |
| M3 | `apps/venue/test/venue.pricing.test.ts` | Total = `priceBundle(bundle)×party_size`; items sum to the total; extra amount fields in the body are rejected (strict zod) |
| M6 | `apps/venue/test/payments.idempotency.test.ts` | `opIds(shareId, op, attempt)`: code ≤59 chars and deterministic; transactionId = 30 hex; `classifyAuth` maps every status and outcome per T1; **`unknown` never maps to a retry**; DECLINED/INVALID_REQUEST never trigger a reversal |
| M1 | `apps/venue/test/secrets.layout.test.ts` | Grep over `apps/*/src`, `apps/*/app`, `packages/*/src` (exclude `scratch/`, `docs/`, `node_modules`): no `process.env.CYBS_` and no `cybersource-rest-client` import outside `apps/venue` |
| M2 | `apps/venue/test/money.paths.test.ts` | Same scope: no `/pts/v2`, `capturePayment`, `authReversal` or `mitReversal` outside `apps/venue/src/cybs`; agent code reaches payments only through `VenuePort` |
| M9 | A's `copy.lint.test.ts`; make sure it scans `apps/venue/app/**` | No "$0 instantly" / "Visa-verified" |
| Shared | `packages/shared/test/tap.test.ts` | Signer→verifier round trip with the real `tap.ts` + `node:crypto` |

**Smoke scripts (`apps/venue/scripts/`, run with tsx against the deployed venue):**
- `seed-test-share.ts` → prints a `/pay/<token>`.
- `agent-sim.ts happy|cancel|tamper|replay|expired|wrong_tag` → prints each `CommitResult.tap.steps`. Expected: `happy` → `captured` with 6 ✓; each negative mode → `rejected` at the expected step, and `GET /orders/{id}` shares still AUTHORIZED (RELEASED after `cancel`).
- `race.ts`: 2 concurrent, independently signed `/checkout` requests → one `captured` with capture calls, one idempotent or 409 response; exactly one capture `payment_ops` row per share.
- `check-share.ts <shareId>` → `getTransaction`.

**Manual phone tests (iPhone, cellular):**

| # | Action | Expected |
|---|---|---|
| 1 | Open a pay link; 4111 1111 1111 1111, future expiry, CVC 123, save ☑ | "Held $X on Visa ••1111. Not charged yet." Ledger HELD with a real ID; a `venue.customers` row |
| 2 | New plan, same payer | One-tap "Hold $X on Visa ••1111" → Held without card entry (COF) |
| 3 | Reopen a used link | State 5 |
| 4 | Link past its TTL | State 4 |
| 5 | Mock mode, `first_name=decline` | State 3; "Try another card" works; the agent receives `share.declined` with a new URL |
| 6 | Mock mode, `first_name=timeout` | State 7(b); after the next sweep, RELEASED + a fresh-link event |
| 7 | All shares held | Auto-commit → all CAPTURED; Business Center shows the captures |
| 8 | Team phone "I'm out" | All RELEASED; DM "Nobody was charged; your pending authorization was released."; Business Center shows reversals |
| 9 | Airplane-mode toggle mid-form | The page recovers, or state 7(a) → Reload works |

---

## 9. Cut list (in order) and never-cut items

**Cut in this order if behind:**
1. OG image.
2. Saved-card one-tap (keep TOKEN_CREATE off; every hold uses Microform).
3. Automatic fresh links after timeout reversals: send `share.released{retry:false}`. That share stays RELEASED and the plan cancels at the approval deadline (all-or-nothing still holds).
4. (Removed: the route is 3 lines and A's `create_order` calls it.)
5. Sweep actions (a), (f) and (h): restart-safety extras.
6. The storefront page beyond one line.

**Never cut:**
- All-or-nothing capture with the business checks.
- Cancel / deadline → reverse all.
- TAP verify (6 steps) + Tamper.
- Timeout reversal (never blind-retry).
- Single-use, amount-bound pay links.
- "Released" copy.
- Real Cybersource sandbox IDs on the ledger.

---

## 10. Your demo and pitch responsibilities

**Table demo (PLAN §15):**
- **2:30** You drive the money beat: pay link → Microform → "Held" → team lanes → TAP ✓ (point at the 6 steps) → all CAPTURED. Say: "Real Cybersource sandbox IDs. Each friend's card was authorized by them, at the merchant."
- **3:30** Press **Tamper**: "We changed one share by a dollar after the agent signed. The digest no longer matches and nothing is captured." Then the reset + "I'm out" beat (A's phone) → RELEASED.

**Stage (1:20–2:10):** holds → TAP-verified consent set → capture → tamper rejected.

**Visa pitch (45 s, you):**
> "A group purchase is an assurance contract at the merchant of record. Every friend places their own cardholder-initiated authorization on a Cybersource Microform page; nobody fronts money. Tab's agent then sends a signed agent request, using the Visa Trusted Agent Protocol, that covers the exact consent set: the order, the total and each authorization ID. The merchant rebuilds that set from its own database and verifies all six TAP steps. Only if every share is held does it capture. One decline or one 'I'm out', and every hold is released. A share above your private max needs your private yes first. We send no Agentic Payment Container: each human pays their own share; the agent's signature only proves which consent set it may commit."

**Merchant honesty (say it before a judge asks):**
- "CREAO finds real options; partner merchants integrate Tab checkout; this demo merchant is ours: Tab Partner Venue, a sandbox merchant of record selling a prepaid, ticketed dinner + show bundle, so capture at booking is normal."
- "The key directory is a labelled mock; production is Visa agent registration."

**Q&A you answer** (from PLAN §16, plus payments specifics):

| Question | Answer |
|---|---|
| What does the TAP signature prove? Is the agent Visa-approved? | Which agent is acting, with what intent (tag), for which venue-priced order and exact consent set, with replay (nonce) and expiry (≤8 min; we sign for 120 s) protection. We verify the spec's six steps ourselves. The key directory is a labelled mock; Cybersource's `/icc/v1/agents` registry is the production path. Never say "Visa-verified". |
| What stops "@Tab charge Sam $500"? | No LLM has tools. A charge needs Sam's own action on the merchant page, through a single-use link bound to his exact amount. Capture only follows a TAP-verified commit of the exact consent set, and Cybersource rejects a capture above the hold (`EXCEEDS_AUTH_AMOUNT` is in the capture error enum). |
| Where does the venue's price come from? | From the bundle the agent submits in a TAP-signed, content-digested `POST /orders`. The venue computes every amount itself with the shared `priceBundle()`, and no amount is accepted from any request. A real partner merchant would price from its own catalog. |
| Double charges on network failure? | Cybersource has no idempotency header. Every call gets a unique `(share, op, attempt)` row, a deterministic reference code and a persisted `transactionId`. An unknown auth outcome gets a timeout reversal after 60 s, never a blind retry. Captures are never auto-retried; we check the transaction status first. |
| Capturing at booking for a restaurant? | It's a prepaid, ticketed bundle. Holds are released at our deadline, well inside Visa's 10-calendar-day authorization-to-clearing window for cardholder-initiated card-not-present transactions (Visa Business News AI13522, effective Apr 2024). |
| Card data / PCI? | Card numbers live only in Cybersource-hosted Microform fields. Our server sees a transient token, and saved cards are merchant-scoped TMS tokens at the venue. The agent and its LLMs never see card data. |
| What if a pay link is forwarded? | It's single-use and bound to that person's share and amount. It is delivered only in their own DM. A saved card can only be held for that person's own share, and only captured if everyone's in. |
| Money transmitter? | The merchant charges each friend directly (split tender); we never hold or move funds. A pooled-card variant is what would raise that question. (Not legal advice.) |
| Why not 3DS, Click to Pay, network tokens, ICC mandates? | They're gated or in pilot for a hackathon sandbox; they're on our production-path slide. The consent model maps onto ICC purchase-intent mandates. |
| Commerce impact? | Three live counters from our own data: groups converted all-or-nothing, $ fronted by any individual (always $0), holds released on failed plans. No invented stats. |

---

## 11. UNVERIFIED items and their smoke tests (record results in PLAN §19)

**Resolved by this research** (update §19):
- **Capture context:** `new MicroformIntegrationApi(cfg, apiClient).generateCaptureContext(req, cb)` → `POST /microform/v2/sessions`, accepts `application/jwt`, returns a String JWT. Read `ctx[0].data.clientLibrary` / `clientLibraryIntegrity` from the payload. Source: SDK `src/api/MicroformIntegrationApi.js`; official flex sample `app.js`.
- **Microform JS:** `new Flex(cc)` → `flex.microform('card', {styles})` → `createField('number'|'securityCode', {placeholder}).load(sel)` → `createToken({expirationMonth, expirationYear}, (err, token) => …)`. The token goes in as `tokenInformation.transientTokenJwt`. Source: official `views/index.ejs` / `app.js`.
- **SDK signatures:** `createPayment(body, cb)`, `capturePayment(body, id, cb)`, `authReversal(id, body, cb)`, `mitReversal(body, cb)` → `/pts/v2/reversals`, `getTransaction(id, cb)` → `/tss/v2/transactions/{id}`.
- **Auth config:** `jwtKeyType:'SHARED_SECRET'` (README: "Recommended migration from HTTP Signature"); default timeout 60 s (`apiClient.timeout`); MLE optional, off by default.
- **Spec limits:** `clientReferenceInformation.code` max 59, `transactionId` max 30. The COF fields (`initiator.type` customer|merchant, `credentialStoredOnFile`, `storedCredentialUsed`), `paymentInformation.customer.id` and the TOKEN_CREATE response ids exist in the spec.
- **Vercel durations:** fluid compute is on by default, with a 300 s default and 300 s max on Hobby. `maxDuration` 60/120 is fine.
- **Next 16.4.2:** `serverExternalPackages`, `transpilePackages`, `maxDuration`, `await params`, `connection()` and `next/og` are all documented.

**Still open:**

| Item | Smoke test | When |
|---|---|---|
| Sandbox activation time; TMS enabled | — (sign up at 4:25); S1 TOKEN_CREATE | now |
| Microform on the Vercel production origin; localhost (the sample uses `http://localhost:3000`; the docs don't state it) | S6 locally; T2 on an iPhone at the production URL | 6:45 |
| Microform works with `Referrer-Policy: strict-origin` | T2 on an iPhone | 6:45 |
| `serverExternalPackages` makes the SDK work in Next 16 route handlers on Vercel | `next build` on Vercel + one live auth from the deployed route | 6:45 |
| COF accepted: `credentialStoredOnFile` on the first auth; `type:'customer'` + `storedCredentialUsed` + `paymentInformation.customer.id` on one-tap | S1 + S4 | before T6 |
| TOKEN_CREATE returns `tokenInformation.customer.id` on Microform auths | S6 auth with `save` | T2 |
| Minimal `billTo` set (the samples always send address1/locality/administrativeArea) | S1 | before T6 |
| `merchantDescriptor` accepted and rendered | S1 + Business Center | S1 / 5:30 AM |
| Where brand/last4 appear (`paymentAccountInformation.card`, `paymentInformation.card`, or the transient-token payload `data.number`/`data.type`) | Log the redacted key names once in S1/S6 (never the token) | T2 |
| Timeout-reversal response when the original never reached Cybersource | S5 with an unused transactionId | before T9 |
| Sandbox decline through Microform (the documented triggers are Luhn-invalid PAN / expiry 1998 and may be blocked client-side) | Try expiry 1998 in Microform; else use mock mode for DECLINED | T6 |
| `DUPLICATE_REQUEST` 15-minute default | S1 repeated with the same `code` | S1 |
| Double-capture reason | S2 second capture | before T7 |
| Supavisor login as `tab_venue.<ref>` (A's §19 item; affects you) | `psql` with the transaction-pooler URL; fallback: single role | 6:00 |
| Visa: mock key directory OK; `@method` + `content-digest` extension OK; tag usage; `/icc/v1` for hackathon sandboxes | Booth (§4.2) | 6:45 |
| `TAX = 0.1025` (B's PR; C acks venue prices) | CDTFA address lookup | 9:30 PM |

**Docs used:**
- **Cybersource:**
  - SDK `cybersource-rest-client@0.0.84` via unpkg (`README.md`, `src/api/{Payments,Capture,Reversal,MicroformIntegration,TransactionDetails}Api.js`, `src/ApiClient.js`, `src/authentication/core/MerchantConfig.js`, `src/authentication/logging/{Logger,LogConfiguration}.js`, `src/utilities/capturecontext/CaptureContextParsingUtility.js`, `src/index.js`)
  - https://github.com/CyberSource/cybersource-rest-samples-node
  - https://github.com/CyberSource/cybersource-flex-samples-node
  - Microform v2 client setup: https://developer.cybersource.com/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept-flex/microform-integ-v2/micro-getting-started-pay-card/micro-getting-started-pay-card-cs-setup.html
  - Security keys: https://docs.cybersource.com/content/dam/documentation/en/admin/security-keys/creating_and_using_security_keys.pdf
  - Sandbox: https://developer.cybersource.com/hello-world/sandbox.html
  - Testing guide: https://developer.cybersource.com/hello-world/testing-guide.md
  - Developer MCP: https://pypi.org/project/cybersource-developer-mcp/
- **Visa:** TAP spec https://developer.visa.com/docs/trusted-agent-protocol/trusted-agent-protocol-specifications; AI13522 summary (Visa authorization framework PDF on visa.com).
- **RFCs:** RFC 9421 (HTTP Message Signatures; `ed25519` alg registry entry) and RFC 9530 (Digest Fields).
- **Node:** Node 22.20.0 `crypto` (Ed25519 `sign`/`verify` with a `null` algorithm, JWK export/import), run locally.
- **Next.js 16.4.2:** `serverExternalPackages`, `transpilePackages`, route segment config (`maxDuration`, `runtime`), `route.mdx` (async `params`), `connection`, `opengraph-image`.
- **Vercel:** function duration docs.
- **postgres.js** 3.4.9 README (`prepare`).

---

## Verification log

**Corrections made to the draft:**
1. **Source list:** the "local spec `docs/research/cybs-spec.json`" is a 20 MB file. It is not committed; only a pointer goes in `docs/research`. The security-key doc link (`…/keys-rest-create.html`) returns **404**. It is replaced with the official PDF (HTTP 200), and the steps were re-confirmed (the first value is the key ID, the second the shared secret).
2. **SDK error convention:** `ECONNREFUSED`/`ETIMEDOUT` come back as a translated `{errno, code, syscall, address, port}` object, not the raw axios error. An axios timeout (`ECONNABORTED`) comes back raw. A decrypt failure is a plain `Error`. **`err.response.req.data` holds the request body (token/PAN)**, not only headers, so the rule is now "never log the SDK error or response whole". The wrapper now classifies on `typeof err.status === 'number'`.
3. **Auth body:** added `commerceIndicator:'internet'` (official flex sample). `customerId` is sent only when there is no transient token, which fixes the draft sending both `tokenInformation` and `paymentInformation.customer` on "Use a different card". Added a `sandboxTestCard` path, because the T2 fallback button had no service method behind it. The `merchantDescriptor` and minimal-`billTo` fallbacks are now explicit (all official samples send address1/locality/administrativeArea).
4. **`classifyAuth`:** the draft reversed every non-AUTHORIZED status that had an id, including DECLINED and INVALID_REQUEST, which hold nothing. Now only statuses that may hold funds are reversed. A failed reversal maps to AUTH_UNKNOWN, so the sweep timeout-reverses it by `transactionId`.
5. **Spikes:** 8 × 15 min (2 h) didn't fit the 4:45–6:00 window. They are merged into 6 spikes (~60–70 min) and written as a `CybsService`-shaped module, so T1 becomes a 15-min port. Added second-capture and second-reversal probes. `CaptureContextParsingUtility` (verified to exist) is marked skip-worthy: it adds a public-key fetch per page load for no gain.
6. **Timeline:** T1 and T2 were both "6:15–6:45 in parallel" for one person. They are now sequential: T0 6:00–6:10, T1 6:10–6:25, T2 6:25–6:45.
7. **Next.js 16:** `export const dynamic='force-dynamic'` is replaced by `await connection()`. In 16.x, `dynamic` is removed when Cache Components is enabled (16.4.2 docs). `runtime='nodejs'` is documented as the default, so the export is dropped. `Referrer-Policy: no-referrer` → `strict-origin`, which keeps the token out of Referer without risking Microform's origin checks (UNVERIFIED either way; smoke test added).
8. **Durations:** checkout, cancel and sweep get `maxDuration = 120`; four sequential captures at a 20 s timeout can exceed 60. The agent's `commit`/`cancel` timeout went from 30 s to 90 s. The Vercel default duration (300 s, fluid) is resolved and removed from the open list.
9. **Checkout ordering bug:** in the draft, the "already CAPTURED → 200 idempotent" path came after business checks that always fail on a captured order (shares no longer AUTHORIZED), so it was unreachable. The status check now comes first, inside the locked transaction.
10. **`POST /orders` conflict:** "reuse + rotate PENDING tokens" would have broken links for orders with held shares. Reuse is now allowed only when every share is PENDING; otherwise 409.
11. **Sweep:** shares stuck in REVERSING (a reversal with an unknown outcome during cancel) were never retried. They are now in action (e).
12. **Counters:** they were in-memory counts that reset on agent restart. They are now computed from `app.plans` and `app.events`.
13. **Hook:** the HMAC must be computed over the raw body (`c.req.text()`), not re-serialized JSON. Outbox `event_id` is generated at enqueue and reused on redelivery, so A's dedupe works.
14. **Privacy and money hardening:** pay URLs are never in SSE, events or logs. `bill_to` is never stored. Added the forwarded-link answer to Q&A, and the venue-price-provenance disclosure (the price comes from the TAP-signed agent bundle; strict zod rejects body amounts).
15. **TAP:** `routeTag` dropped its unused `path` argument. Documented that the spec's own example spells `keyId` and that Visa's directory uses RSA-style JWKs (ours is OKP, labelled mock). We require `keyid` per RFC 9421. Locally, `VENUE_PUBLIC_HOST` must include the port.
16. **M1/M2 grep tests:** scoped to source dirs, excluding `scratch/` and `docs/`. Otherwise they would fail on the scratch spikes and the docs.
17. **Pay-page states:** the authorize route's `error` state wasn't one of the 7. It is folded into state 7(b) ("couldn't confirm"), with the draft's copy.
18. **Wording:** the AI13522 Q&A answer is restated as the "10-calendar-day authorization-to-clearing window for cardholder-initiated CNP" (verified wording), not "10-day CIT window".
19. **Two PLAN conflicts flagged [→ PLAN]**, not changed silently: (a) the `payer_ref` 64-hex HMAC vs. the `^[0-9a-f]{32}$` contract; (b) `PAY_LINK_TTL_MIN=30` vs. an approval window longer than about 60 min, which makes `T_REPING` links expire.
20. **`tap.ts`:** imported via a subpath (`@tab/shared/tap`) so `node:crypto` stays out of the `apps/web` bundle. The export map needs confirming with the foundation.

**Confirmed unchanged:**
- **Registry versions:** `cybersource-rest-client` 0.0.84 is `latest` (2026-10-05); next 16.4.2; react 19.3.1; postgres 3.4.9; zod 4.6.7; vitest 5.0.5; tsx 4.23.15. TypeScript `latest` is 7.0.2; PLAN pins 6.0.3 on purpose.
- **SDK:** all API method names, argument order and endpoints; JWT shared-secret config; `logConfiguration.enableLog`; the default timeout of 60000.
- **Cybersource spec:**
  - capture statuses: PENDING/TRANSMITTED;
  - reversal status: REVERSED;
  - capture 400 reasons, including `EXCEEDS_AUTH_AMOUNT`, `AUTH_ALREADY_REVERSED` and `DUPLICATE_REQUEST`;
  - the `/icc/v1/agents` paths and SDK `AgentRegistrationApi`.
- **Official samples:**
  - the Microform sample code;
  - the `mitReversal` body shape;
  - the decline triggers (expiry 1998, Luhn-invalid PAN) in the testing guide.
- **Standards and runtime:**
  - TAP spec: required fields, tags, the 8-minute window, nonce retention, the six checks, and "additional fields" allowed;
  - RFC 9421 `ed25519` and the base format; RFC 9530 `sha-256=:…:`;
  - Node 22.20.0 Ed25519 round trip (JWK `{crv,x,kty}`, 64-byte signature, verify true/false);
  - `randomBytes(15).hex` = 30 chars; `randomBytes(16).base64url` = 22 chars;
  - postgres.js `prepare` option;
  - `pipx install cybersource-developer-mcp` + `start`.

**Left UNVERIFIED** (each has a smoke test in §11):
- **Sandbox behaviour:**
  - activation time and TMS enablement;
  - COF flags and one-tap acceptance;
  - TOKEN_CREATE ids on Microform auths;
  - minimal `billTo`;
  - `merchantDescriptor` acceptance and rendering;
  - where brand/last4 appear (including the v2 transient-token payload shape);
  - the timeout-reversal response for a never-sent transactionId;
  - `DUPLICATE_REQUEST` default;
  - the double-capture reason;
  - a sandbox decline via Microform.
- **Platform:**
  - Microform on the production origin and on localhost;
  - Microform with `Referrer-Policy: strict-origin`;
  - SDK bundling in Next 16 on Vercel with `serverExternalPackages`;
  - Supavisor custom-role login.
- **Visa booth answers:** mock key directory, the extension components, tag usage, `/icc/v1` access.
- **B's item:** the LA `TAX` rate.
- **Not specified anywhere:** a minimum wait before a timeout reversal. The 60 s is our own choice, consistent with PLAN.
