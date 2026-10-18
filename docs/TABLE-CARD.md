# SquadTab: what is real (print this, one page)

Agent shopping today is one person, one card. SquadTab is the group case: private budgets, and a purchase that only goes through if all N agree. Built with Cybersource and the Trusted Agent Protocol. Nothing here is certified or endorsed by Visa.

## Real
- iMessage on Photon: each friend has a private DM and their own Claude delegate. A delegate sees only that person's budget and preferences. Budgets are never shared (a build-failing test seeds odd budgets and checks nothing leaks).
- Cybersource API calls: authorization with `capture:false` (a hold), capture, reversal, and a timeout reversal. Capture happens only after every share is held; cancel, deadline, "I'm out" and timeouts release the holds.
- Card entry in Cybersource's hosted Microform fields. Card numbers never touch SquadTab servers.
- Our own Ed25519 / RFC 9421 request signer (agent) and a 6-step verifier (merchant): tag, params, timestamps, nonce, key, signature.
- The agent can commit only the exact consent set: order, total and every authorization id, rebuilt by the merchant from its own database. Change one share by $1 and the signature check fails; nothing is captured.
- Real option research on CREAO (Scout) and a real post-booking itinerary (Concierge).

## Mock
- The Trusted Agent Protocol key directory. The merchant reads our own public key from configuration, labelled "mock directory". Production would use Visa's.
- The merchant. "SquadTab Partner Venue" is our demo merchant of record selling a prepaid, ticketed bundle. It is not a real business.
- A labelled simulation mode exists as a backup. If it is on, the pay page says "Simulated". It is off for the live demo.

## Sandbox
- All payments run in the Cybersource sandbox on the shared public test merchant `testrest`. Test cards only (Visa test card ending 1111). No real money moves.
- Our own sandbox merchant fails every authorization with a Cybersource-side processor configuration error (reason 150). Cybersource support case SR#002689822 is open; we replied with request ids.

## Not built
- Visa Intelligent Commerce agentic payment tokens
- Payment Passkey
- 3-D Secure / payer authentication
- Visa agent registration (a real key directory)
- Agentic Payment Container (each human pays their own share instead)
- Refunds after capture (only pre-capture reversals are implemented)
- A real merchant integration or production Cybersource credentials
