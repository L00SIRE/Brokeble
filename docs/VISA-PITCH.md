# Visa track: 90-second talk track and judge Q&A

Rules for every sentence: sandbox is sandbox, mock is mock. Never say "Visa-verified", never imply Visa certified, endorsed or provided anything. Merchant benefits are design properties, not measured results.

## The 90 seconds (about 230 words)

**0:00 Thesis.** "Agent shopping today is one person, one card. Groups are the unsolved case: private budgets, and a purchase that only goes through if all N agree. We built that with Cybersource and Trusted Agent Protocol."

**0:15 Visa's brief, in our product.** "Your brief asks for a commerce experience powered by generative AI that is intuitive, personalized, frictionless, with secure and trusted payments.
- Personalized and AI-powered: every friend gets a private Claude delegate over iMessage. It sees only their own budget and preferences, and budgets are never shared. Plain code, not a model, picks the plans everyone can afford.
- Intuitive and frictionless: no new app, it is a text thread. Each person pays only their own share, so nobody fronts the bill and nobody chases anyone.
- Secure and trusted: card numbers go only into Cybersource's hosted Microform fields. Each friend places their own hold. Then our agent signs a commit request under Trusted Agent Protocol, and the merchant verifies it in six steps before capturing anything."

**0:50 Commerce impact.** "Groups convert all-or-nothing: either every share is held and the purchase goes through, or every hold is released. No one fronts money, and the design avoids half-paid plans. For a merchant, the design gives a guaranteed party with every share authorized up front, which should mean fewer no-shows. That is a design property, not a measured result."

**1:10 Honesty, then demo.** "Honest scope: sandbox payments on Cybersource's shared test merchant, and a mock key directory. In production we would use Visa's real directory and Visa Intelligent Commerce agentic tokens. Now watch the Trust Console: I press Tamper, then Replay."

## Live-demo cue: "Press Tamper. Press Replay."

Trust Console TAP panel, with `?ops=1` and the operator key. The panel shows six rows in protocol order. Prerequisite: the plan must have a venue order. Use the buttons once the plan has reached APPROVING or CAPTURED, not on a fully held OPEN order (Replay refuses that state, because its first request would capture; `apps/agent/src/venueClient/tapTest.ts:22-25`).

| Button | What the judge sees | Step |
|---|---|---|
| Tamper | One share changed after signing. Steps 1 to 5 pass; step 6 "Signature good" fails with "content-digest mismatch: body changed after signing". Nothing captured. | 6 |
| Replay | A validly signed request is sent a second time. Step 4 "Never reused" fails: "nonce replayed". | 4 |
| Expired (if time) | Step 3 "Not expired" fails. | 3 |
| Wrong tag (if time) | Step 1 "Agent known" fails. | 1 |

The six steps are: 1 tag, 2 params, 3 timestamps, 4 nonce, 5 key ("key resolved (mock directory)"), 6 signature. Say what step 5 means: the key lookup is against our mock directory.

Known issue to avoid on stage: Replay on an OPEN, fully held order can return a 500 instead of 409 (`docs/REPORT.md`, "Known non-blocking issues").

## What to show instead of Business Center

We have no Business Center access: our own merchant fails at authorization (below). Show instead:
1. The pay page header, which names its source ("Cybersource sandbox · shared public test merchant").
2. The Trust Console ledger of holds, captures and releases.
3. If the console's live Cybersource transaction view has shipped (being built in parallel; check it is on the deployed console before promising it), open it and point at the real authorization ids and statuses. If it has not, say nothing about it.

## The honest merchant story

"We ran in the Cybersource sandbox on the shared public test merchant, `testrest`. We also set up our own sandbox merchant. Every authorization on it fails with a Cybersource-side processor configuration error: reason 150, the processor is missing an outlet id. We opened a Level II support case, SR#002689822. They applied a fix at 8:20 this morning that did not take, and we replied with request ids. So the full flow is proven on the shared merchant, and our own merchant is waiting on Cybersource."

## Production path

In production we would swap the mock key directory for Visa's real one, register the agent, and use Visa Intelligent Commerce agentic payment tokens on the merchant side instead of cardholder-typed Microform entry alone. Not built today: VIC tokens, Payment Passkey, 3-D Secure, Agentic Payment Container.

## Judge Q&A cheat sheet

1. **What is your PCI scope?** Card entry happens only inside Cybersource's hosted Microform fields, so card numbers never touch our servers; we receive a transient token. That is the design intent of Microform. We have not done a PCI assessment, and this is a sandbox with test cards.
2. **Why sandbox?** It is a hackathon and we have no production merchant. Payments run on Cybersource's shared public test merchant with test cards only. Our own sandbox merchant fails every auth with reason 150 on the processor side; support case SR#002689822 is open.
3. **What does TAP verify?** Six steps at the merchant: the signature tag fits the route, required parameters exist, the signature is inside its time window (ours expires after 120 s, max 8 minutes), the nonce was never used, the key is known, and the Ed25519 signature is valid over method, authority, path and a content digest of the body. The key directory is a mock.
4. **What does the agent's signature actually authorize?** Only the exact consent set: order id, total, and each share's id, amount and authorization id. The merchant rebuilds that from its own database and compares byte for byte; it also requires every share authorized and the shares to sum to the total. Otherwise nothing is captured.
5. **What if one friend's card declines?** That share shows declined with a "try another card" link. The order stays open, the others' holds stay in place until the deadline, and nothing is captured. If it is never fixed, the deadline releases every hold.
6. **What if a capture fails halfway?** Captures run one by one after the commit. If one fails after others succeed, the order is flagged "needs attention" for follow-up rather than silently retried. Honest gap: that window is small but real.
7. **Refunds after capture?** Not built. We implement reversals of holds before capture (cancel, deadline, "I'm out", timeout). A post-capture refund would be a separate flow.
8. **Data privacy?** Budgets live in one database table and are read only by that person's delegate and the plain-code filter and hold gate. No model has tools, there is no group-coordinator model, and research on CREAO gets only enums, area, date, times and party size. A build-failing test seeds odd budgets and checks they appear nowhere else.
9. **Why not Venmo or Splitwise?** Those settle after someone fronts the money. Here no one fronts: every share is a hold and the purchase happens only when all are held. Also, budgets stay private; the group never sees why an option was dropped.
10. **How does this become VIC?** Swap the mock key directory for Visa's registry, and have each delegate use Visa Intelligent Commerce agentic tokens, with the cardholder's consent per share, in place of the hosted-field entry alone. The all-N-hold-then-commit structure and the consent-set binding stay the same. We have not built or tested any of this.
11. **Did Visa certify this?** No. It uses the public Trusted Agent Protocol spec and Cybersource's sandbox. Nothing is Visa-verified or Visa-approved.
12. **Is the merchant real?** No. "SquadTab Partner Venue" is our demo merchant of record. Real partners would integrate the checkout.
13. **3-D Secure?** Not built; sandbox test cards only.
