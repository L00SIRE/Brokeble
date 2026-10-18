# SquadTab: chat-first flow (organizer and friend)

Status: design for tonight's build. Code freeze is at noon and the demo is at 12:30.
Scope: the web entry, the iMessage hand-off, plan creation in chat, the live web status, the API and router changes, and the build plan.
Out of scope: visual design (colors, type, motion, logo). The parallel design workflow owns that, and this doc only fixes the file boundary between the two (section 10).

Line numbers refer to `foundation` at commit `e965b8a` (2026-10-18 00:03 PDT). As of verification (00:15 PDT), `git status` shows no modified tracked files; the earlier delegate edits (`free.ts`, `prompts.ts`, `anthropicLLM.ts`, `converse.ts`, `converseSchema.ts`) are committed in `e965b8a`. Builders still must not stash, reset or check out other people's files.

**Hard clock (CLAUDE.md):** code stops at 12:00 PM PDT and there are **no deploys after 11:30 AM**. Every time in this doc is bounded by that.

---

## 0. Decisions in one screen

1. **The web asks for one thing: the person's iPhone number.** No name, no budget, no plan form, no consent checkbox. Everything else happens in iMessage.
2. **The organizer starts on `/` with one field and one tap.** New `POST /start` creates their seat with no plan. Messages opens with the text already typed. They describe the plan in chat ("Santa Monica tonight, 4 of us"), and the agent creates it (new `plan/startByChat.ts`).
3. **The organizer is a participant in their own plan from the moment it exists.** They never see a join form and never type their number twice. This applies to both creation paths: chat (`startByChat`) and the legacy `POST /plans`.
4. **Friends get the invite in one tap and join in one field.** The organizer forwards the link the agent texts them, or uses the native share sheet on the web. On `/j/[code]` the friend sees the actual plan (title, date, area, who invited them), types their number, taps **Join in iMessage**, and presses send.
5. **Any first text counts as joining.** For an `INVITED` participant, the first message moves them to `JOINED` whatever it says. The pre-filled text can be human ("I'm in for Dinner + comedy show!") instead of `JOIN 4821`. The current dead end goes away.
6. **The budget is asked only in the private chat.** The web never asks for it. The server keeps `budget_usd` as an optional field for backward compatibility, but the web stops sending it.
7. **No QR code on phones, and no copy-only links.** Sharing uses `navigator.share()`, with copy as the fallback. A QR code appears only on desktop. Before any submit, the desktop page's primary element is **"Scan to start on your iPhone"**: a QR of the page's own URL (`/` or `/j/[code]`). It costs no seat and skips typing a phone number on a laptop. This is also the booth and judge path (PLAN §15: "the judge scans the QR → `/j/4821`"). Entering the number on the desktop stays available as a secondary path, which then shows a QR to the `https://` hand-off page `/t/<token>`. A QR never encodes a raw `sms:` URI.
8. **After the person texts, the web becomes a live status page.** It polls a new `GET /status?t=` endpoint. States: waiting for your text, got it, plan ready (share it), you're in. Plan details appear only after the person's own text has arrived, which proves they own the number (section 7.2).
9. **Cut line.** If chat-based creation isn't green by **09:30**, ship the fallback: `/` becomes a 3-field form (where, how many, phone) that calls `POST /plans`, which now seats the organizer. That leaves two hours for device tests before the 11:30 deploy freeze. Every other item still ships (section 10.4).

Interaction count (taps plus fields, through to the first message sent):

| Who | Today (audit) | New |
|---|---|---|
| Organizer | ~20 to 24, phone and name typed twice | **3**: type phone (or one autofill tap), tap **Start in iMessage**, press send |
| Friend | ~9 to 11 | **3**: type phone, tap **Join in iMessage**, press send |

That is the platform minimum on a Free shared line (section 1).

---

## 1. Verified constraints (why one field, not zero)

| Constraint | Source |
|---|---|
| A shared line cannot send an unsolicited first message. | Photon `/beta/get-started/imessage` lines 16-17 |
| Only messages from the assigned sender reach a shared-line connection. | `/beta/get-started/imessage` lines 35-37 |
| A phone number and an Apple-account email are different senders. | `/beta/get-started/imessage` lines 30-32 |
| The line sends only to a peer with an active assignment who has messaged it since that assignment, otherwise `SHARED_LINE_NOT_ASSIGNED` or `SHARED_LINE_INBOUND_REQUIRED` (403). | `/beta/api-reference/messages/send-a-message`; `/beta/problems/catalog` |
| Assignments are created by `handle` (E.164 phone or email). The call is synchronous: a 201 returns `assignedPhoneNumber`. Free plan: 25 seats. | `/beta/api-reference/shared-line-assignments/create-shared-line-assignment`; `/beta/plans-and-billing` |
| Each user may get a different number from the shared pool, so there is no single public number on Free. | `/spectrum-ts/providers/imessage/connection-and-routing` |
| Photon recommends `sms:+1...&body=Hey!` deep links: "the user is the one who hits send". | `/best-practices/imessage-deliverability` line 15 |
| No links or media in the agent's first message, because Apple suppresses link clicks until a reply lands. | `/best-practices/imessage-deliverability` line 74 |
| Apple trusts a conversation after the user has sent at least 3 messages. | `/best-practices/imessage-deliverability` line 18 |
| Shared lines support direct conversations only, no groups. | `/beta/get-started/imessage`, "If the reply does not arrive" table: "A shared assignment supports direct conversations, not group chats." |
| Pace outbound naturally ("Don't fire several within seconds"). At most 2 back-to-back bubbles per turn. | `/best-practices/imessage-deliverability` line 63 |
| No contact-card or rich-link send type in the beta REST API. | OpenAPI `components.schemas.SendContent`: text, text.update, attachment, voice, reaction, message.delete, message.read, space participants/typing, poll, poll vote/update, group |
| Whether an Android phone's SMS reaches a shared iMessage line is **not documented** (no "android" match anywhere under `/beta`). | photon-docs `rg -i android /beta` returns nothing |

**Consequence.** The backend must know a person's handle before their first text can reach us. The smallest possible web step is one field. "Just chat from the beginning" becomes: one field, then one tap that opens Messages with the text typed, then everything else in chat.

Repo facts this design relies on:

- `messaging.assign()` already leaves out `firstName` when it is blank (`apps/agent/src/photon/messaging.ts:86-92`).
- `ensureSeat(user, planId)` reuses an active seat and adopts one on `ASSIGNMENT_EXISTS` (`apps/agent/src/join/seats.ts:29-48`). Its idempotency key comes from `joinIdempotencyKey(planId, userId, releasedCount)` (`seats.ts:21-23`).
- The router already sends a known user with no active plan to its own branch (`route.ts:63`), so start-by-chat has a natural hook.
- `dm_routes.updated_at` is set on insert (column default `now()`, `db/migrations/001_app.sql`) and on every later inbound (`repo/dmRoutes.ts:6-14`, called at `route.ts:39`), so it can tell the web "your text arrived". Photon delivers only the assigned handle's messages, so an `updated_at` later than a token's issue time means the owner of that number texted after the token was issued. Section 7.2 uses that as the proof-of-possession gate.

---

## 2. The flow at a glance

### Organizer (phone)

```
/  "Plan the night in one text."  [ (310) 555-0123 ]  [Start in iMessage]
      │ POST /start → seat, status_token
      ▼
Messages opens: "Hey SquadTab! Help me plan a night out."  → user presses send
      │ the web tab now shows the live status (waiting → got it)
      ▼
Agent: hello, asks name, where, when, how many  (text only, no link)
User:  "maya! santa monica saturday, 4 of us"
Agent: "You're set, Maya: Dinner + show, Sat, Oct 24 from 7:00 PM in Santa Monica, 4 of you.
        Send this link to your group chat and I'll take it from there: https://…/j/4821"
Agent: budget question (private)          ← organizer is already a participant
      │ web flips to "Plan ready": plan card, [Send invite to your group] (share sheet), "1 of 4 in"
      ▼
Organizer forwards the link in Messages (or taps Share on the web) → group chat shows a rich preview
```

### Friend (phone)

```
Group chat: rich preview "Maya's planning Dinner + show · Sat 7 PM · Santa Monica"
      │ tap
      ▼
/j/4821  Maya invited you · Dinner + show · Sat, Oct 24 · 7:00 PM · Santa Monica · 2 of 4 in
         [ (310) 555-0123 ]  [Join in iMessage]
      │ POST /join → seat, INVITED, status_token
      ▼
Messages opens: "I'm in for Dinner + show!"  → user presses send   (any text works)
      │ web flips to "You're in!"
      ▼
Agent: welcome, asks name → budget (private) → preferences → "waiting on 1 more friend…"
```

### Desktop (any role)

**Before any submit**, the primary element is a QR code of the page's own URL (`/` or `/j/4821`), captioned **"Scan to start on your iPhone"** (or "Scan to join on your iPhone"). It costs no seat and asks for nothing, and the phone continues with the normal phone flow, including `autocomplete=tel` autofill. This is the booth and judge path.

Below it is a secondary disclosure, **"Or enter your number here"**, with the same single field. After that submit the page shows a second QR for `https://tab-web-ten.vercel.app/t/<status_token>`, captioned "Continue on your iPhone". The phone camera opens that page, which shows the same **Text SquadTab** button, built for that phone's user agent. The laptop keeps showing the live status, which reads well on a projector. On a Mac there is also a tertiary **Open Messages on this Mac** link, with a caveat (section 6).

---

## 3. Platform rules (exact syntax)

### 3.1 Detection: new `apps/web/lib/platform.ts`, pure, unit-tested

```ts
export type Platform = "ios" | "android" | "mac" | "desktop";
export function detectPlatform(ua: string, maxTouchPoints: number): Platform {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return "ios"; // iPadOS reports Macintosh
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua)) return "mac";
  return "desktop";
}
```

Run it client-side only, after mount, so the server render and the first client render match. Render the phone layout first: it is the primary audience, and it avoids a layout shift for most visitors.

### 3.2 `sms:` link: new `apps/web/lib/sms.ts`, pure, unit-tested

```ts
export function smsHref(number: string, body: string, p: Platform): string {
  const sep = p === "android" ? "?" : "&";          // iOS/macOS: "&body="; RFC 5724 (Android): "?body="
  return `sms:${number}${sep}body=${encodeURIComponent(body)}`;
}
```

- The client builds the link from `assigned_number` and `sms_body` in the response. The server also keeps returning `sms_href` in the iOS form, for older clients.
- Render a link only when the number matches `^\+\d{8,15}$`. That is stricter than today's trust check, which only tests `sms_href.startsWith("sms:")` (`JoinForm.tsx:206`).
- iOS honoring `&body=` is de facto behavior, not documented by Apple (Sendblue guide; `docs/research/ui-ux.md:44`). **UNVERIFIED on iOS 26: test it on the demo phones (section 11.3).** The flow still works if the body is dropped, because any first text counts as joining (section 8.1).

### 3.3 Pre-filled bodies

| Who | `sms_body` |
|---|---|
| Organizer, no active plan | `Hey SquadTab! Help me plan a night out.` |
| Organizer or friend already in an active plan | `Hey SquadTab, where are we at?` |
| Friend joining | `I'm in for {title}!` if the title is 40 characters or fewer, else `I'm in!` |

### 3.4 Auto-open after submit

After a successful response, the client sets `window.location.href = smsHref(...)` once, only on `ios`, and only if the response arrived within 4 s of the tap. It always also renders the large fallback button. Safari may block a navigation that happens after an `await`: **UNVERIFIED, device test 11.3(b).** If the test fails, delete the auto-open line. The one-tap button is still there.

### 3.5 Sharing: new `apps/web/lib/share.ts`

```ts
export async function shareInvite(p: { title: string; dateLabel: string; url: string }): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const text = `${p.title}, ${p.dateLabel}. Tap to join: ${p.url}`;   // URL inside text: iOS copies `text`, not `url`, when both are set (adactio.com/journal/15972)
  if (typeof navigator.share === "function") {
    try { await navigator.share({ title: p.title, text }); return "shared"; }
    catch (e) { return (e as DOMException)?.name === "AbortError" ? "cancelled" : "failed"; }
  }
  try { await navigator.clipboard.writeText(p.url); return "copied"; } catch { return "failed"; }
}
```

- Call it only from a click handler, because `navigator.share` needs a user gesture.
- Web Share is supported in iOS Safari 12.2+ (caniuse `web-share`).
- On `"failed"`, show the URL as a real `<a>` with a Copy button.

---

## 4. Screens and exact copy

Visual styling belongs to the design workflow. This section fixes structure, states and words. Copy rules:

- Say what the person gets, not what the platform can't do.
- No "can't text you first".
- Never say "You're in" before the server confirms it.

### 4.1 `/`: Start (organizer)

| Element | Copy |
|---|---|
| Headline | **Plan the night in one text.** |
| Subhead | SquadTab plans dinner and a show with your friends, keeps everyone's budget private, and nobody fronts the bill. |
| Field label | Your iPhone number |
| Placeholder | (310) 555-0123 |
| Input attributes | `type="tel" inputMode="tel" autoComplete="tel" name="phone" enterKeyHint="go"`, one input, no split fields (Safari autofill) |
| Primary button | **Start in iMessage** (pressed state: spinner and "Getting your line…") |
| Microcopy under the button | You'll send the first text. By continuing, you agree SquadTab can text you about your plans. Text "forget me" anytime. |
| Secondary link | Got an invite from a friend? Just tap their link. |
| Inline error, invalid phone | That doesn't look like a US mobile number. Try 10 digits, like (310) 555-0123. |
| Android notice (replaces the form) | **SquadTab lives in iMessage.** Open this page on an iPhone, iPad or Mac to start a plan. |

The page shows a live preview of the iMessage thread next to the form on desktop and above the fold on phones. That visual belongs to the design workflow.

### 4.2 Hand-off (organizer and friend, after a successful submit)

**Phone (`ios`)**

| Element | Copy |
|---|---|
| Title | **Hit send in Messages** |
| Body | We'll pick it up here the moment your text lands. |
| Primary button (`<a href=sms…>`) | **Text SquadTab** |
| Disclosure, collapsed by default | Messages didn't open? |
| Disclosure content | Text this number: **(213) 555-0147** [Copy] · Say: "Hey SquadTab! Help me plan a night out." [Copy] |

**Desktop (`desktop` or `mac`), before submit (replaces the form as the primary element on `/` and `/j/[code]`)**

| Element | Copy |
|---|---|
| Title | **Scan to start on your iPhone** (on `/j/[code]`: **Scan to join on your iPhone**) |
| Body | Point your camera here. SquadTab lives in iMessage. |
| QR | The page's own absolute URL, rendered as SVG on the server by new `apps/web/lib/qr.ts` (add `qrcode@1.5.4` to `apps/web`, the same pinned version the agent uses), 200 px with a quiet zone. It costs no seat. |
| Secondary disclosure | Or enter your number here → the single phone field from 4.1 or 4.4 |

**Desktop (`desktop` or `mac`), after a desktop submit**

| Element | Copy |
|---|---|
| Title | **Continue on your iPhone** |
| Body | Scan with your iPhone camera. It opens Messages with your first text ready to send. |
| QR | `handoff_qr_svg` (encodes `https://<web>/t/<status_token>`), 200 px, with a quiet zone |
| Under the QR | Or text **(213) 555-0147** from your iPhone and say "Hey SquadTab! Help me plan a night out." |
| `mac` only, secondary link | Open Messages on this Mac |
| `mac` caveat (small) | Send it from your phone number, not your Apple ID email. |

### 4.3 Live status (the same page, polling `GET /status`)

| Phase | Shown when | Title | Body / actions |
|---|---|---|---|
| `waiting` | no inbound since the token was issued | Hit send in Messages | (as 4.2) |
| `waiting`, 45 s or more | the same phase, still waiting at 45 s | Not seeing your text yet | It has to come from •••• {last4}. [Text SquadTab] · [Wrong number? Fix it] · Texting from an email address? On your iPhone, open Settings, Apps, Messages, Send & Receive, and pick your phone number under "Start new conversations from". |
| `texted` (organizer) | inbound arrived, no plan yet | **Got it. Keep chatting in Messages.** | Checklist: ✓ Texted SquadTab · ◻ Plan set · ◻ Friends invited |
| `plan_ready` (organizer) | plan exists, the caller organizes it, and the caller's text has arrived since the token was issued | **{title}** | Meta line: {Sat, Oct 24} · {7:00 PM} · {Santa Monica}. Count: **{k} of {n} in**, as filled dots, not names. Friends' names are deliberately left off the web (privacy, section 7.2); the organizer sees who joined in iMessage. Primary: **Send invite to your group** (share). Secondary: Copy link. Note: SquadTab texted you the link too. |
| `joined` (friend) | own stage ≥ JOINED | **You're in{, Leo}!** | SquadTab is texting you now. Finish up in Messages, it takes about a minute. Checklist: ✓ Joined · ◻ Budget (just between you and SquadTab) · ◻ What you're into. The boxes tick from the person's own stage: BUDGET_LOCKED, then PREFS_DONE. |
| `closed` | plan CANCELLED, CONFIRMED or past VOTING | This plan's wrapped up | Want to start your own? [Start a plan] |

- Polling: every 2 s while the tab is visible (`document.visibilityState`), and every 10 s after 2 minutes. Stop after 15 minutes. Poll again on `visibilitychange` back to visible, which is exactly when the person returns from Messages.
- Accessibility: announce each phase change in an `aria-live="polite"` region and move focus to the new heading.
- Respect `prefers-reduced-motion` for the tick animations.

**Wrong number? Fix it.** This returns to the phone step with the number pre-filled and selected. Resubmitting creates a new seat for the corrected number. The mistyped seat is released by `/ops/release-untexted` once it is 15 minutes old. No message ever goes to the mistyped number, because the line can't text first. That privacy property is worth saying out loud to judges.

### 4.4 `/j/[code]`: Invite (friend)

The page is server-rendered with `GET /plans/:code`. If the agent is unreachable, it falls back to a generic header and the form still works.

| Element | Copy |
|---|---|
| Eyebrow | {Maya} invited you |
| Title | **{Dinner + show}** |
| Meta line | {Sat, Oct 24} · {7:00 PM} · {Santa Monica} |
| Social proof | {2} of {4} in |
| Three short lines with icons | Tell SquadTab what you're into, by text. · Your budget stays between you and SquadTab. · Nobody fronts the bill, and nobody pays until everyone's in. |
| Field label | Your iPhone number |
| Primary button | **Join in iMessage** (pressed: "Saving your spot…") |
| Microcopy | You'll send the first text. By joining, you agree SquadTab can text you about this plan. Text "forget me" anytime. |
| Already joined (token in `localStorage` for this plan, or `already_joined: true` from the server) | **You're already in.** [Open Messages] |
| Organizer opens their own link (token role is organizer for this plan) | **This is your plan.** {k} of {n} in. [Send invite to your group] |

Error states (replace `JOIN_FAILURE_COPY` in `apps/web/lib/joinForm.ts`):

| Error | Title | Body |
|---|---|---|
| `not_found` (404), or a bad code format | We couldn't find that plan | Double-check the link {Maya} sent, or start your own. [Start a plan] |
| `plan_closed` (409) | This plan's already moving | It's past the joining stage. Ask the organizer to start a new one, or [start your own]. |
| `plan_full` (409, new) | This plan's full | It already has 8 people, the most SquadTab plans for. [Start your own] |
| `capacity` (503) | SquadTab is packed right now | Every line is busy. Try again in a few minutes. |
| `rate_limited` (429) | Too many tries | Wait a minute, then try again. |
| network | Couldn't reach SquadTab | Check your connection and try again. Nothing was sent. |
| Android (detected) | **SquadTab lives in iMessage** | Open this link on an iPhone, iPad or Mac to join {Maya}'s plan. |

### 4.5 `/t/[token]`: hand-off target (new, phone side of the QR)

The phone version of 4.2 and 4.3: the **Text SquadTab** button, built from `GET /status`, then the same live status. If the token is invalid or expired: "This link expired. Start again on [squadtab]" with a link to `/`.

### 4.6 Link preview: `app/j/[code]/opengraph-image.tsx`

- 1200×630, generated from `GET /plans/:code`.
- Shows the plan title, date, time and area, plus "{Maya} is planning". Never budgets, never friends' names.
- Apple TN2444 recommends a page-specific `og:image` and keeping text inside it minimal. Use large type and the brand visual from the design workflow.
- `generateMetadata` sets `title: "{Maya} invited you: {title}"` and a description of "{date} · {time} · {area}".
- Keep `robots: noindex` (link previews ignore it).
- Verify the `next/og` `ImageResponse` API for Next 16.4 with Context7 before writing it.

---

## 5. Chat script: the first 60 seconds

`T_*` names marked new are added to `packages/shared/src/templates.ts`. Every message is a fixed template (P3/P4), except where a `T_DELEGATE_REPLY` already applies. The agent's first reply to anyone contains no link (Photon deliverability rule).

### 5.1 Organizer

| t | From | Message | Code |
|---|---|---|---|
| 0 s | Maya | Hey SquadTab! Help me plan a night out. | pre-filled; first inbound creates the `dm_route` |
| ~1 s | — | read receipt, typing | `markReadSafe`, `typingOn` (`route.ts:53-54`) |
| ~2 s | SquadTab | Hey! I'm SquadTab. I'll plan dinner and a show with your friends, keep everyone's budget private, and nobody fronts the bill. What should I call you, and where and when are we going? Like: "Maya, Santa Monica tonight, 4 of us" | **T_START_HELLO** (new) |
| ~15 s | Maya | maya! santa monica saturday, prob 4 of us | `parsePlanDraft` → name Maya, area Santa Monica, date 2026-10-24, party 4, no time given (default 19:00) |
| ~17 s | SquadTab | You're set, Maya: Dinner + show, Sat, Oct 24 from 7:00 PM in Santa Monica, 4 of you. Send this link to your group chat and I'll take it from there:⏎https://tab-web-ten.vercel.app/j/4821 | **T_PLAN_READY** (new). The URL sits alone on the last line (⏎ = newline), so a long-press copies cleanly and tapping it opens `/j/4821`, which recognizes the organizer ("This is your plan" + one-tap share sheet, 4.4). In the happy path it is the 2nd outbound, sent after the user's 2nd inbound |
| ~18 s | SquadTab | First up: what's the most you'd want to spend tonight, all-in? Totally private. Nobody in the group, and no other agent, ever sees it. | existing T_BUDGET_ASK; organizer is JOINED via `createPlanRecord` |
| ~30 s | Maya | like 60, 80 tops | existing budget delegate |
| ~32 s | SquadTab | Got it. Just between us: aim ~$60, never over $80. Text 'change budget' anytime. | T_BUDGET_CONFIRM |
| ~33 s | SquadTab | Last one: anything you're craving, can't eat, or want to steer clear of tonight? | T_PREFS_ASK |
| ~45 s | Maya | no seafood, something funny | prefs delegate → PREFS_DONE |
| ~47 s | SquadTab | Noted: no seafood, and a funny show. Waiting on 3 more friends to finish up, then I'll start looking for dinner and a show. | existing prefs ack and `whereThingsStand` |

Maya sends 4 messages in under a minute, past Apple's 3-message trust threshold.

Missing-field branches, at most 2 asks before falling back to defaults:

- Area missing: **T_START_ASK_AREA** (new), "Sounds fun! Which neighborhood or city should I look in?" Area is required. It keeps asking (it can't research without it), at most once per inbound.
- Party size missing: **T_START_ASK_COUNT** (new), "Got it. How many of you, counting you?" Defaults to 4 after one unanswered ask.
- Both missing: **T_START_ASK_BOTH** (new), "Sounds fun! Where should I look, and how many of you, counting you?"
- Date missing: today (America/Los_Angeles). Time missing: 19:00. End time: start + 4 h, capped at 23:59.
- Title: always "Dinner + show". The research pipeline is fixed to dinner and show (`converse.ts whereThingsStand`; PLAN §6 row 6), so asking "what" would promise something the product doesn't do.

**Copy flag (team decision, money/privacy copy is frozen per PLAN §8).** T_BUDGET_ASK and T_PREFS_ASK say "tonight". For a plan on another day, change them to "...spend, all-in?" and "...steer clear of?". Recommended, but only with the copy owner's sign-off.

### 5.2 Friend

| t | From | Message | Code |
|---|---|---|---|
| 0 s | Leo | I'm in for Dinner + show! | pre-filled; INVITED, so it counts as joining whatever it says (section 8.1) |
| ~2 s | SquadTab | Hey, you're in for Dinner + show, Sat, Oct 24! I'm SquadTab. A few quick questions and I'll get planning, and whatever you tell me stays between us. First, what should I call you? | **T_JOIN_WELCOME_NAME** (new), used when `first_name = ''` |
| ~8 s | Leo | leo | `looksLikeName` → `setFirstName('Leo')` |
| ~9 s | SquadTab | Nice to meet you, Leo. Next: what's the most you'd want to spend tonight, all-in? Totally private. Nobody in the group, and no other agent, ever sees it. | **T_BUDGET_ASK_NAMED** (new) |
| ~20 s | Leo | 40 max honestly | budget delegate |
| ~22 s | SquadTab | Got it. Just between us: aim ~$35, never over $40. Text 'change budget' anytime. | T_BUDGET_CONFIRM |
| ~23 s | SquadTab | Last one: anything you're craving, can't eat, or want to steer clear of tonight? | T_PREFS_ASK |
| ~35 s | Leo | vegetarian! | PREFS_DONE → `onPrefsDone`; if the count reaches `party_target`, research starts |
| ~37 s | SquadTab | Got it, vegetarian. Waiting on 1 more friend to finish up, then I'll start looking for dinner and a show. | prefs ack |

The name step runs **only** while the in-memory awaiting flag is `"name"`. `onJoinText` sets that flag when it sends T_JOIN_WELCOME_NAME, and the next inbound clears it. It never infers the step from `first_name === ''` alone. Otherwise a blank-name organizer answering T_BUDGET_ASK with "maybe sixty" would be saved as the name "Maybe".

If Leo skips the name and answers the budget ("40 max"), `looksLikeName` returns false. The text goes to `handleBudgetText`, the name stays blank, and the agent never asks for it again (no nagging). The console shows "Guest {lane}" for a blank name. After a restart the flag is gone and the text goes to the budget path, which is the safe default.

If the body was dropped and Leo types "hey": same path. INVITED → `onJoinText` → T_JOIN_WELCOME_NAME.

---

## 6. Edge cases

| Case | Behavior |
|---|---|
| **Android** | Detected client-side before any POST, so no seat is spent. Shows the "SquadTab lives in iMessage" notice. A small "I'm on an iPhone" link reveals the form anyway, in case detection is wrong. This is a product decision, not a verified platform limit: Photon's beta docs say nothing about Android or SMS senders on shared iMessage lines. |
| **Desktop Windows/Linux** | Form works. Hand-off shows the QR to `/t/<token>` plus the number and message to type on the phone. `sms:` links never appear (they do nothing on Windows; Sendblue guide). |
| **Mac** | QR first. "Open Messages on this Mac" second, with the caveat. If Mac Messages sends from an Apple ID email, the handle won't match the phone assignment and the message is dropped (`/beta/get-started/imessage`: a phone number and an Apple-account email are different senders). The 45 s help line covers this. |
| **In-app browsers** (Instagram, etc.) | `sms:` hand-off may be blocked (linkrunner.io; UNVERIFIED). The visible number and message plus Copy buttons in "Messages didn't open?" are the fallback. |
| **Already joined, same plan** | `POST /join` is already idempotent (`upsertParticipant` returns the existing row, `ensureSeat` reuses the seat). Add `already_joined: stage !== 'INVITED'` to the response. The web skips to "You're already in" with **Open Messages**. |
| **Organizer opens their own invite link** | `localStorage` token resolves via `/status` to role organizer for this code → "This is your plan" plus Share. If there is no token (another device) and they submit their number: `/join` sees an existing participant, returns `already_joined: true` → "You're already in". |
| **User already in another active plan** (`/start`) | `/start` returns **exactly the same response shape and body** as for a new user. Phone numbers are unverified, so a different answer would let anyone learn "this number is in a plan on Sat in Santa Monica" by typing someone else's number. After the real owner texts, `/status` shows that plan: phase `plan_ready` if they organize it, otherwise the guest phases. Their text goes to their existing plan's stage handler (one active plan per person, `currentPlanForUser`, `route.ts:44`). |
| **Plan full** | `join()` counts participants not in DECLINED or RELEASED. If there are 8 or more and the caller isn't already one → 409 `plan_full`. 8 = the `party_size` max in `ResearchBrief` (`packages/shared/src/index.ts:35`) and the `party_target` max in `CreatePlanBody` (`apps/agent/src/join/schemas.ts:29`). |
| **Plan closed** | Existing 409 `plan_closed` (`routes.ts:69`), with the new copy. |
| **Wrong number typed** | No message ever reaches the mistyped number. The status page waits; at 45 s it offers "Wrong number? Fix it". The orphaned seat is freed by the new `POST /ops/release-untexted` (section 7.2). |
| **Seat capacity (25)** | 503 `capacity` with the new copy. `/start` costs a seat, just like `/join`. Every judge who submits a number spends one, texted or not, so 25 Free seats (`/beta/plans-and-billing`) run out at a busy expo. Run **`/ops/release-untexted`** before each demo. It frees only seats whose user never texted since the seat was created. Do **not** use `/ops/release-seats` (`releaseAllExceptTeam`, `seats.ts:59-73`) while judges are mid-plan: it releases everyone outside `DEMO_TEAM`, and their next texts are silently dropped (A-platform-conversation M14). |
| **Abuse: seat burning** | `/start` limited to 5/min per IP and `/join` to 10/min per IP (existing limiter). `GET /plans/:code`: 60/min per IP. Codes are 4 digits and guessable, so the public preview shows only the organizer's first name and counts, never friends' names. |
| **Shared venue Wi-Fi (one egress IP for everyone)** | `/status` is rate-limited **per token** (40/min, enough for 2 s polling), with only a loose 600/min per-IP ceiling. A 60/min per-IP limit would throttle the second judge polling from the same Wi-Fi within a minute. Note: `GET /plans/:code` is fetched by the Next server, so its "IP" is Vercel's egress. The web fetches it with `next: { revalidate: 10 }`, not `no-store`. |
| **Duplicate taps** | The button is disabled while submitting. Server calls are idempotent per user (seat reuse, participant upsert). |
| **First text is "stop" or "I'm out"** | The command wins over the forgiving join (section 8.1): `onOut` declines them. |
| **Card number as the first text** | The existing intercept runs first (`route.ts:46-51`). |
| **LLM down** (`LLM_MODE=mock` or a failure) | `parsePlanDraft` falls back to the deterministic parser (section 8.3). Worst case the agent asks area and count explicitly. |
| **Agent restarts mid-draft** | The draft is in memory, like `awaiting.ts`. The next text restarts the draft. Fields stated again in the same message are picked up, otherwise the agent re-asks. That is acceptable tonight; a `plan_drafts` table is the follow-up. |

---

## 7. Backend and API changes (owner A1: `apps/agent/src/join/*`, `repo/users.ts`, `cors.ts`)

### 7.1 Shared helpers

**`apps/agent/src/join/statusToken.ts` (new)**

- Token format: `base64url(JSON {u, p, r, iat})` + `.` + `base64url(HMAC-SHA256(key, payload))`.
- Fields: `u` = user id, `p` = plan id or null, `r` = `"organizer" | "guest"`.
- Key: `HMAC(PAYER_REF_SECRET, "status-token-v1")`, a domain-separated derivation, so no new Fly secret is needed. Use the same dev fallback as `repo/users.ts:payerRefSecret`.
- TTL: 7 days.
- `verify()` uses `timingSafeEqual`.
- Exports: `issueStatusToken(...)` and `verifyStatusToken(t): {u, p, r, iat} | null`.

**`apps/agent/src/join/createPlanRecord.ts` (new; extracted from `createPlan`, `routes.ts:106-126`)**

```ts
export async function createPlanRecord(
  organizer: UserRow,
  f: { title: string; area: string; date: IsoDate; time_start: HHMM; time_end: HHMM; party_target: number },
  o: { organizerStage: "INVITED" | "JOINED" },
): Promise<{ plan: PlanRow; join_url: string }>
```

It does, in order:

1. The code allocation loop (skips `DEMO_CODE`, retries on 23505).
2. `insertPlan`.
3. `upsertParticipant(plan.id, organizer.id)` and emits `lane`.
4. If `organizerStage === "JOINED"`, moves the organizer to JOINED via `membership.setStage`.
   - `startByChat` passes `JOINED`, because it sends T_BUDGET_ASK itself in the same turn, so the next inbound must go to the budget step.
   - `POST /plans` passes `INVITED`. The organizer's first text then goes through the forgiving join (8.1) → T_JOIN_WELCOME and T_BUDGET_ASK. Without this, that first text ("Hey SquadTab! Let's get planning.") would be parsed as a budget answer.
5. Enqueues `org_join_status`.
6. Returns `join_url`.

The organizer's seat must already exist. Both callers have one: `/start` or `POST /plans`.

A1 writes this file first, in the first 30 minutes. A2 codes against this signature.

**`seats.ts`** (today: `ensureSeat(user, planId)` at `seats.ts:29`, `joinIdempotencyKey(planId, userId, releasedCount)` → `join:${planId}:${userId}[:n]` at `seats.ts:21`)

- Change to `ensureSeat(user, scope: string)` and `seatIdempotencyKey(scope, userId, n)` → `${scope}:${userId}[:n]`.
- `/join` passes `join:${planId}`, so its keys are byte-identical to today's and replays still match. `/start` and `POST /plans` pass `start`.
- `n` stays the user's total released-seat count (`countReleasedAssignments`), so a re-seat after any release always gets a fresh key. Otherwise Photon replays the released assignment.
- Update `seats.test.ts`.
- New `releaseUntexted(olderThanMin = 15)`. It releases active assignments created more than 15 minutes ago whose user has no `dm_routes` row, or one with `updated_at < assignments.created_at`, meaning they never texted on this seat. It uses the same sequential, log-and-continue loop as `releaseAllExceptTeam`, plus a repo query in `repo/assignments.ts`. It is mounted as `POST /ops/release-untexted` in `ops/routes.ts`, behind the existing operator auth, and shown as a button on the console ops bar. Release is repeat-safe and frees "both its seat and its handle" (Photon release-shared-line-assignment).

**`repo/users.ts` `upsertUserByPhone`**

- `first_name` may be `''`, meaning unknown.
- On conflict: `set first_name = case when excluded.first_name = '' then app.users.first_name else excluded.first_name end`.
- A blank never overwrites a real name.
- Add `setFirstName(userId, name)`, a guarded update that only writes when the current name is `''`.
- `app.users.first_name` stays `NOT NULL`, so no migration is needed.

### 7.2 Endpoints

All are mounted inside `mountJoin` (`routes.ts:27`). `plan/register.ts` stays untouched.

**`POST /start` (new)**

```
body    { phone_e164: E164, consent: true }
200     { assigned_number, sms_body, sms_href, status_token, handoff_url, handoff_qr_svg }
errors  422 invalid · 429 rate_limited (5/min/IP) · 503 capacity
```

Flow:

1. `upsertUserByPhone({phone, first_name: ''})`.
2. `ensureSeat(user, "start")`.
3. `sms_body` is always "Hey SquadTab! Help me plan a night out.". The response is **identical whether or not the number is already in a plan**, because the number is unverified (section 6). No `state` and no `plan` are returned. The plan is revealed only by `/status`, after the owner's own text.
4. Issue a token with `r: "organizer"` and `p: null`.
5. `handoff_url = ${WEB_ORIGIN}/t/${token}`.
6. `handoff_qr_svg = QRCode.toString(handoff_url, {type:"svg", margin:1, width:200})`.

**`POST /join` (changed)**

- `JoinBody.first_name` becomes `.optional()`, default `''`.
- `budget_usd` stays optional and is no longer sent by the web.
- `consent: true` stays.
- New check before writes: plan full → 409 `{error:"plan_full"}`. Add `"plan_full"` to `JoinErrorCode`.
- Response adds `sms_body` (`I'm in for {title}!` or `I'm in!`), `status_token` (`r: "guest"`, `p: plan.id`), `handoff_url`, `handoff_qr_svg`, `already_joined`, and `plan: PlanPreview`.
- `join_text` = `sms_body`, for compatibility.
- `sms_href` keeps the iOS form.

**`POST /plans` (changed; the fallback path)**

- Body unchanged.
- After `upsertUserByPhone(body.organizer)`: `ensureSeat(organizer, "start")` (CapacityError → 503), then `createPlanRecord(organizer, ..., { organizerStage: "INVITED" })`.
- Response: `{ code, join_url, assigned_number, sms_body: "Hey SquadTab! Let's get planning.", sms_href, status_token, handoff_url, handoff_qr_svg }`.
- Keep returning `qr_svg` until the new web is deployed (section 7.3 deploy order), then drop it. Nothing outside `CreatePlanForm.tsx` and `lib/agent.ts` reads it.
- `CreatePlanBody` keeps `organizer.first_name` required. The fallback form sends `''`, which `.min(1)` rejects, so change it to `.max(40).default('')`.

**`GET /plans/:code` (new, public)**

```
200  PlanPreview = { code, title, date_label: "Sat, Oct 24", time_label: "7:00 PM", area, organizer_first_name: string | null, joined: number, party_target: number, status: "open" | "closed" | "full" }
404  { error: "not_found" }
```

- `joined` counts stage ≥ JOINED, excluding DECLINED and RELEASED.
- `status` is `open` when the plan is in JOINABLE and has fewer than 8 participants.
- Headers: `Cache-Control: public, max-age=15`. Rate limit 60/min per IP. Server callers come from Vercel's egress, so the web caches with `revalidate: 10` (section 6).
- Accepted risk: a 4-digit code is enumerable, so anyone can learn title, date, time, area and the organizer's first name for live codes. That is the price of a warm invite page. The real fix is longer invite codes (`plans.code` is `char(4)`, which needs a migration), which is out of scope tonight. Say this plainly if a Visa judge asks about Trust.
- Response built from a whitelist object. A test asserts the exact key set, so budgets and other names can never leak.

**`GET /status?t=` (new)**

```
200 { phase: "waiting" | "texted" | "plan_ready" | "joined" | "closed", role, phone_last4, assigned_number, sms_body,
      first_name: string | null, plan: (PlanPreview & { join_url }) | null, steps: { budget: boolean, prefs: boolean } | null }
401 invalid or expired token
```

Logic:

1. `texted` = `dm_routes.updated_at >= to_timestamp(iat)` for user `u`.
2. **Proof-of-possession gate.** While `!texted`, return `phase: "waiting"` with only `role`, `phone_last4`, `assigned_number` and `sms_body`; `first_name`, `plan` and `steps` are null. Phone numbers are unverified, and anyone can type someone else's number into `/start` and get a token for that user. Photon delivers only the assigned handle's own messages (`/beta/get-started/imessage` lines 35-37), so a text after `iat` is the only proof the token holder owns the number.
3. `plan` = `p ? getPlan(p) : currentPlanForUser(u)`.
4. Phase:
   - Organizer token and `plan.organizer_id = u`: `plan_ready`. Organizer token with no plan: `texted`. Organizer token whose plan someone else organizes: the guest phases.
   - Guest: `joined` if own stage ≥ JOINED; else `waiting`.
   - `closed` if the plan is in a terminal state.
5. No member names on the web at all, only counts (`PlanPreview.joined`). `steps` comes from the caller's own stage, as booleans only.
6. Never returns any budget.
7. Rate limit 40/min **per token** (the `u` + `iat` pair), plus 600/min per IP as a loose ceiling (venue Wi-Fi, section 6).

Residual risk, accepted: if the real owner happens to text SquadTab during the 7-day TTL of a token someone else minted for their number, that token passes the gate. It then exposes only what the public `/j/[code]` preview already shows, plus two booleans. To narrow it, the web stops polling after 15 minutes.

**`cors.ts`**

`PUBLIC_CORS_PATHS = ["/join", "/plans", "/plans/:code", "/start", "/status", "/events", "/events/snapshot"]` (`cors.ts:8`; `app.ts:29` loops over it, and `app.ts` itself is frozen). Hono `app.use` paths without a wildcard match only that path (Hono middleware guide: `app.use('/posts/*', cors())`), so `"/plans"` does not cover `/plans/1234`. Use `"/plans/:code"` or `"/plans/*"`. `allowMethods` already includes GET (`cors.ts:12`). `/plans/:code` is mostly called server-side by Next, and CORS there only matters if a client component refetches counts.

### 7.3 Web client contracts (A1 publishes; W1 mirrors in `apps/web/lib/agent.ts`)

Add zod schemas `StartRequest`, `StartResponse`, `PlanPreview`, `StatusResponse`, and the extended `JoinResponse`. Add `"plan_full"` to `JoinError`. Keep both files in sync, as the existing comment says (`schemas.ts:1-2`). Deploy-order note (checked against `apps/web/lib/agent.ts:16,29,32-35`):
- The web mirrors are non-strict `z.object`, so **added** response fields are harmless to the live web.
- Two changes do break the live web if the agent deploys first:
  - Dropping `qr_svg` from `POST /plans`, which `CreatePlanResponse` requires.
  - The new `plan_full` error, which degrades to `"unknown"` copy (`agentRequest.ts:30-31`).
- So keep `qr_svg` in the `/plans` response until the new web is live, then remove it in a follow-up. Alternatively, deploy agent and web back to back.

---

## 8. Router and chat changes (owner A2; exact file list in section 10.1)

### 8.1 Forgiving first message (`route.ts`, after `const cmd = parseCommand(text)` at line 61)

```ts
const joinsCurrent = !cmd || cmd.kind === "help" || cmd.kind === "status" || (cmd.kind === "join" && cmd.code === ctx?.plan.code);
if (ctx?.participant.stage === "INVITED" && joinsCurrent) return onJoinText(user, ctx.plan.code, e);
```

- `out`, `forget_me` and the other commands still run as commands.
- An explicit `JOIN 1234` for a different code still goes through `handleCommand`.

Loosen the join regex in `commands.ts:40` to search anywhere in the bare text: `/\bjoin\s*#?\s*(\d{4})\b/`. Covers "join #4821" and "Join 4821 please".

### 8.2 Name step

- **`membership.ts onJoinText`**: if `user.first_name === ''`, send T_JOIN_WELCOME_NAME instead of T_JOIN_WELCOME. Skip `confirmFormBudget` and T_BUDGET_ASK, because the name reply triggers the budget ask. Otherwise behavior is unchanged.
- **`delegates/awaiting.ts`**: extend `AwaitingFlag` (today `"holdgate" | "tiers" | "budget"`, `awaiting.ts:3`) with `"name"`. `onJoinText` calls `setAwaiting(user.id, "name")` right after sending T_JOIN_WELCOME_NAME.
- **`route.ts` awaiting branch** (lines 65-76): add `else if (flag === "name") { clearAwaiting(user.id); return looksLikeName(text) ? onNameText(ctx, text, e) : handleBudgetText(ctx, e); }`. The stage branch at line 79 is **unchanged**. The name step is driven by the flag, never by `first_name === ''` alone (section 5.2).
- **`onNameText`** (in `membership.ts`): `setFirstName`, then `setStage` re-emit so the console lane shows the name, then T_BUDGET_ASK_NAMED with key `replyKey(e.message_id, 1)`.
- **`looksLikeName(text)`** (`commands.ts`, pure): after `bare()`, strip a leading "i'm", "im", "it's", "call me" or "this is". Accept 1 to 2 words of letters, apostrophes or hyphens, at most 20 characters. Reject:
  - digits and `$`;
  - the words budget, max, spend, no, yes, help, status, maybe, like, around, about, idk, not, cheap, whatever, anything, nothing;
  - the number words one through twenty, thirty through ninety, hundred and k.
  
  Return the first word title-cased. Unit-test it: "leo" → Leo, "it's Sam!" → Sam, "40 max" → null, "no idea" → null, "maybe sixty" → null, "around forty" → null.

### 8.3 Plan creation by chat (`plan/startByChat.ts`, new)

Change `route.ts:63` from `if (!ctx) return handleFreeText(user, null, e);` to `if (!ctx) return handleStartText(user, e);`.

```ts
// In-memory draft per user (like delegates/awaiting.ts). Lost on restart: the next text restarts the draft.
type Draft = { first_name?: string; area?: string; date?: IsoDate; time_start?: HHMM; party?: number; asks: number; hello: boolean };
export async function handleStartText(user: UserRow, e: InboundEvent): Promise<void>
```

1. `merge(draft, await parsePlanDraft(text, todayLA(), draft))`.
2. Validate each field in code:
   - `area`: trimmed, 2 to 60 characters, and must match `/^[\p{L}][\p{L} .,'&\/-]{1,59}$/u` (so "Westwood / Sawtelle" passes), so no digits, no `$`, no `@`. `area` goes into CREAO's `ResearchBrief` (invariant 5 / P6 allows area but no free text, names or budgets). The LLM extracts it from the organizer's free text, so this is the barrier that stops "santa monica, $60 each" or a phone number from reaching CREAO. Also reject it if `containsCardNumber` matches or it equals the user's `first_name`.
   - `date`: an `IsoDate` from today to today + 30 (LA).
   - `time_start`: `HHMM`.
   - `party`: an integer from 2 to 8.
   - `first_name`: passes `looksLikeName`.
   - Drop anything invalid.
3. If `first_name` is set and `user.first_name === ''`, call `setFirstName`.
4. If nothing was extracted and `!draft.hello`: send T_START_HELLO and set `hello = true`.
5. Else if `area` is missing: T_START_ASK_AREA (or T_START_ASK_BOTH if `party` is also missing); `asks++`.
6. Else if `party` is missing and `asks < 1`: T_START_ASK_COUNT; `asks++`.
7. Else create the plan:
   - `party ??= 4`, `date ??= todayLA()`, `time_start ??= "19:00"`, `time_end = min(start + 4h, "23:59")`.
   - `createPlanRecord(user, { title: "Dinner + show", ... }, { organizerStage: "JOINED" })`.
   - Send T_PLAN_READY `{name_part, title, date: fmtDate, time: clock12, area, n, url: join_url}`, then T_BUDGET_ASK with keys `replyKey(e.message_id, 1)` and `(…, 2)`.
   - Delete the draft.
8. Off-topic text after hello (nothing extracted, hello already sent): use `converseReply(user, null, e)` (existing). Its no-plan `where_things_stand` copy changes to "They're starting a plan. SquadTab needs where and how many people." If it returns false → T_START_ASK_BOTH.

**Link rule, stated precisely.**
- T_START_HELLO has no link. With the fixed prefill ("Hey SquadTab! Help me plan a night out."), nothing is extracted from the first text, so T_PLAN_READY is at the earliest the 2nd outbound, after the user's 2nd inbound.
- If a user edits the prefill to contain everything ("santa monica tonight, 4 of us"), the plan is created at once, and T_PLAN_READY with its URL becomes the **first** outbound.
  - Photon's rule ("Apple suppresses link-clicking until a reply lands", `/best-practices/imessage-deliverability` line 74) is written for outbound-first openers. Whether it applies when the user texted first is **UNVERIFIED**.
  - Accepted: the web status page flips to `plan_ready` with the one-tap share button, and the link becomes tappable after the user's next reply (the budget answer). So nothing dead-ends.
- **Pacing:** each turn sends at most 2 bubbles (T_PLAN_READY + T_BUDGET_ASK), matching the existing T_JOIN_WELCOME + T_BUDGET_ASK pattern (`membership.ts:64-69`).
- **Privacy (P2):** `parsePlanDraft` sees only this person's own inbound text and their own draft, so it is "that person's own delegate". If the text contains a budget, it is ignored here, never stored, and asked again privately by T_BUDGET_ASK. `startByChat.ts` must not import `@tab/shared/private` or `repo/privateConstraints` (`privacy.imports.test.ts` allowlist: `src/delegates/**`, `decide/filter.ts`, `decide/score.ts`, `money/holdGate.ts`, `repo/privateConstraints.ts`).

### 8.4 `parsePlanDraft`: LLM port addition

- `ports/types.ts`: `parsePlanDraft(i: { text: string; today: IsoDate; weekday: string; known: Partial<Draft> }): Promise<PlanDraftParse>`.
- Schema (`delegates/planDraft.ts`): `PlanDraftParse = { first_name, area, date, time_start, party_size }`, each nullable, plus `confidence`.
- `anthropicLLM.ts`: `structuredParse("parsePlanDraft", PlanDraftParse, PLAN_DRAFT_SYSTEM, JSON.stringify(i), DELEGATE_CALL)`. Null → all fields null.
- `prompts.ts PLAN_DRAFT_SYSTEM`: extract only what the user stated. Resolve relative dates ("tonight", "tomorrow", "saturday") against `today`/`weekday`. `area` = a neighborhood or city in the user's words. Never invent values.
- `ports/llm.mock.ts`: the deterministic parser, also used as the fallback when the LLM returns null. Lives in `delegates/planDraft.ts`:
  - `/\b([2-8])\s*(?:of us|people|ppl|friends|total)\b/`
  - `/\b(?:in|at|around)\s+([a-z][a-z .'-]{1,40}?)(?=[,.!]|\s+(?:tonight|today|tomorrow|on|this|next|at|for)\b|$)/i`
  - The words tonight, today, tomorrow and weekday names → date.
  - `/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/` → time.
  - A leading `name,` or `I'm X` → first name.

### 8.5 Templates (`packages/shared/src/templates.ts`: add to `TemplateId`, `COPY`, `VARS`)

| Id | Copy | Vars |
|---|---|---|
| T_START_HELLO | Hey! I'm SquadTab. I'll plan dinner and a show with your friends, keep everyone's budget private, and nobody fronts the bill. What should I call you, and where and when are we going? Like: "Maya, Santa Monica tonight, 4 of us" | none |
| T_START_ASK_AREA | Sounds fun! Which neighborhood or city should I look in? | none |
| T_START_ASK_COUNT | Got it. How many of you, counting you? | none |
| T_START_ASK_BOTH | Sounds fun! Where should I look, and how many of you, counting you? | none |
| T_PLAN_READY | You're set{name_part}: {title}, {date} from {time} in {area}, {n} of you. Send this link to your group chat and I'll take it from there:\n{url} | `name_part: z.string()` (", Maya" or ""), `title, date, time, area: s`, `n: count`, `url: z.url()` |
| T_JOIN_WELCOME_NAME | Hey, you're in for {title}, {date}! I'm SquadTab. A few quick questions and I'll get planning, and whatever you tell me stays between us. First, what should I call you? | `title, date: s` |
| T_BUDGET_ASK_NAMED | Nice to meet you, {name}. Next: what's the most you'd want to spend tonight, all-in? Totally private. Nobody in the group, and no other agent, ever sees it. | `name: s` |

Also change **T_NOT_IN_PLAN** (`templates.ts:87`), which is now reached only by plan commands with no plan, and by unknown senders in mock mode:

> You're not in a plan right now. Want to start one? Tell me where and how many of you.

Check whether `render` rejects empty strings before using `name_part`. `VARS` uses `s = z.string().min(1)`, so declare `name_part` as plain `z.string()`.

### 8.6 Small consistency fixes

- **`converse.ts:22` `BASE_COMMANDS`**: no change needed. Joining no longer depends on a command.
- **`jobs/ladder.ts` `orgJoinStatusJob`** (`ladder.ts:44-56`): it now delivers, because the organizer has a `dm_route`. But `k` now **counts the organizer**, who is JOINED or past it. Change `if (k === 0 || ...)` to `if (k < 2 || ...)` (line 51). Otherwise a plan nobody joined sends "1 of 4 have joined. Reply GO to plan with the 1 of you", and `onGo` then refuses anyway (`ready < 2`, `membership.ts:112`). One-line change, owner A2.
- **`onGo`**: works for chat-created plans, because the organizer is a participant.

---

## 9. Web changes (owners W1 and W2; files in section 10)

1. **`/`** (`app/page.tsx`): replace `CreatePlanForm` with `<StartFlow/>` (W1), covering 4.1 → 4.2 → 4.3.
   - Stores `{token, role:"organizer", code?}` in `localStorage["squadtab.session.v1"]`, wrapped in try/catch, as a per-device convenience only.
   - On return visits with a valid token, it resumes the live status instead of showing the form. The organizer never re-enters anything.
   - Also store `phone_last4` for display. Never store the full number.
2. **`/j/[code]`** (`app/j/[code]/page.tsx`): server component fetches `GET /plans/:code` with `next: { revalidate: 10 }` (section 6: Vercel egress shares one rate-limit bucket) and renders `<InviteFlow plan={preview} code={code}/>` (W2), covering 4.4 → 4.2 → 4.3.
   - Stores a token per code: `localStorage["squadtab.join.v1." + code]`.
3. **`/t/[token]`** (new, W2): client page, 4.5.
4. **`app/j/[code]/opengraph-image.tsx`** (new, W2): 4.6.
5. **Retire** `components/join/CreatePlanForm.tsx`, `JoinForm.tsx`, `lib/createPlanForm.ts` and the budget/consent parts of `lib/joinForm.ts` and their tests. Keep `CopyButton.tsx`.
   - Fallback branch (10.4): `CreatePlanForm` shrinks to area, party stepper (2 to 8, default 4) and phone, with date defaulting to today and time 19:00 to 23:00 hidden. Its success screen is the shared hand-off and status components, so there is still no QR on phones and no copy-only link.
6. **Shared hook** `lib/useStatus.ts`: polling with the cadence in 4.3. Pure reducer `lib/statusPhase.ts`, unit-tested.
7. **UI rule** (user's CLAUDE.md): builders touching UI invoke `vercel-react-best-practices`, `vercel-composition-patterns` and `web-design-guidelines`.
   - Build `StartFlow` and `InviteFlow` from one shared compound: `<Flow.PhoneStep/>`, `<Flow.Handoff/>`, `<Flow.LiveStatus/>`. Use variant components, not boolean props.

---

## 10. Build plan (about 4 to 6 hours of agent time, parallel)

### 10.1 Ownership (no two builders edit the same file)

| Builder | Owns (create or edit) | Must not touch |
|---|---|---|
| **A1: API** | `apps/agent/src/join/{routes,schemas,seats,statusToken,createPlanRecord,status,preview}.ts` and their tests, `apps/agent/src/repo/{users,assignments}.ts`, `apps/agent/src/cors.ts`, `apps/agent/src/ops/routes.ts` (only the new `/ops/release-untexted`), the console ops-bar button for it (one line in `apps/web/components/console/*`; coordinate with B) | router, plan, delegates, templates, web flow |
| **A2: Chat** | `apps/agent/src/router/{route,commands}.ts`, `apps/agent/src/plan/{membership,startByChat}.ts`, `apps/agent/src/delegates/{planDraft,anthropicLLM,prompts,converse,awaiting}.ts`, `apps/agent/src/ports/{types,llm.mock,llm.anthropic}.ts`, `apps/agent/src/jobs/ladder.ts` (the line-51 guard only), `packages/shared/src/templates.ts`, `apps/agent/test/router.route.test.ts`, new `apps/agent/src/plan/startByChat.test.ts` | `join/*` (imports `createPlanRecord` and `setFirstName` only), web |
| **W1: Organizer web and shared flow** | `apps/web/app/page.tsx`, `apps/web/components/flow/*` (new: `Flow.tsx`, `PhoneStep.tsx`, `Handoff.tsx`, `LiveStatus.tsx`, `ShareInvite.tsx`, `PlanCard.tsx`, `StartFlow.tsx`, `DesktopScan.tsx`), `apps/web/lib/{agent,agentRequest,platform,sms,share,session,useStatus,statusPhase,qr}.ts` and tests, `apps/web/package.json` (add `qrcode@1.5.4` and `@types/qrcode`; one owner, so no lockfile conflicts), `apps/web/components/join/CreatePlanForm.tsx` (fallback only) | `app/j/**`, `app/t/**`, design-owned files |
| **W2: Friend web** | `apps/web/app/j/[code]/{page,opengraph-image}.tsx`, `apps/web/app/t/[token]/page.tsx`, `apps/web/components/flow/InviteFlow.tsx`, `apps/web/lib/joinForm.ts` (copy table) and test, deleting `components/join/JoinForm.tsx` | W1's lib files (consume only) |
| **Design workflow** | `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `apps/web/components/join/{Shell,ui}.tsx`, `apps/web/components/brand/*`, the iMessage preview visual | flow logic. It may restyle `Shell` and `ui.tsx`, but must keep their exports (`Shell`, `Field`, `inputClass`, `buttonClass`, `Notice`, `Spinner`, `MoneyInput`, `LockIcon`) source-compatible. |

Nobody edits `delegates/free.ts`, `delegates/delegates.test.ts` or the notify tests tonight, except A2 if a test breaks. A2 then fixes forward, never by reverting. `startByChat` imports `converseReply` from `free.ts` and does not edit it.

**Deploy integrator (one person, the human lead).**
- Vercel deploys on push to `main` (CLAUDE.md), and the team works on `foundation`. Only the integrator merges to `main` and runs `fly deploy`, so four builders and the design workflow never race each other's deploys.
- Order: agent first, then web (section 7.3).
- Last deploy 11:30 AM.

### 10.2 Order and timing

Wall clock: this was verified at 00:15 PDT Sunday. If the build starts by about 01:00, the relative schedule below ends near 07:00. That leaves 09:00 to 10:30 for device tests with humans awake, the cut decision by 09:30 at the latest, and the final deploy before the 11:30 freeze.

| Time (from start) | A1 | A2 | W1 | W2 |
|---|---|---|---|---|
| 0:00 to 0:30 | `createPlanRecord.ts`, `users.ts` blank-name upsert and `setFirstName`, `seats.ts` scope. **Publish the contracts** (7.3) as a short note to the others. | Templates, `commands.ts` (`looksLikeName`, join regex) and tests | `platform.ts`, `sms.ts`, `share.ts`, `session.ts`, `statusPhase.ts` and tests | Copy table, page skeleton against the 7.3 contracts with mocked fetch |
| 0:30 to 2:00 | `statusToken.ts`, `POST /start`, `POST /join` changes, `POST /plans` auto-seat, tests | Forgiving join (8.1), name step (8.2), tests | `agent.ts` and `agentRequest.ts` mirrors, `Flow` compound, `StartFlow` | `InviteFlow`, `/t/[token]` |
| 2:00 to 3:30 | `GET /plans/:code`, `GET /status`, CORS, tests | `startByChat.ts`, `planDraft.ts` (mock parser first), tests | `useStatus`, `LiveStatus`, `ShareInvite`, desktop QR | OG image (Context7 for `next/og`), metadata |
| 3:30 to 4:30 | Deploy agent to Fly; smoke 11.2 | LLM `parsePlanDraft` and prompt; deploy together with A1 | Integrate against deployed agent | Integrate; deploy web to Vercel |
| 4:30 to 6:00 | Device tests 11.3 with the team; fix forward | Fix forward | Fix forward | Fix forward |

### 10.3 Integration points

- A2 imports `createPlanRecord` (A1, ready by 0:30) and `setFirstName` (A1).
- W1 and W2 consume the 7.3 schemas. Until A1 deploys, they run against `MESSAGING_MODE=mock` locally, using `POST /dev/inbound {from_handle, text}` to simulate the user's text (`apps/agent/src/dev/inbound.ts:57`) and watching `/dev/outbox`.

### 10.4 Cut line (decide by 09:30; no deploys after 11:30)

- **Must ship, even in the fallback:**
  - Organizer auto-join on `POST /plans`.
  - Forgiving first message.
  - Phone-only `/j/[code]` with the plan preview.
  - Share sheet with copy fallback; QR only on desktop, with the scan-first desktop view (4.2).
  - Live status with the proof-of-possession gate (7.2).
  - Budget removed from the web.
  - `/ops/release-untexted` (small, and it protects the 25 seats during judging).
- **Ships if green by 09:30:** `/start` plus start-by-chat (8.3/8.4). If not green: `/` renders the trimmed `CreatePlanForm` (area, party, phone) posting to `POST /plans`, with the same hand-off and status components.
- **Nice to have:** OG image, name step. Without the name step, `/join` keeps `first_name` optional, and blank names show as "Guest" on the console.

---

## 11. Test plan

### 11.1 Automated (`pnpm -r typecheck && pnpm -r test`)

**Agent, A1**

- `/start`: seats with scope `start`; returns a token that verifies; **response is byte-identical in shape and `sms_body`** for a new user and for a user already in a plan (no `state`, no `plan`); 503 on CapacityError; 429 after 5 calls per minute.
- `/status` gate: a valid token with no `dm_routes.updated_at >= iat` returns `waiting` with `plan`, `first_name` and `steps` all null, even when the user organizes an active plan. The response never has a `members` key. Per-token limit returns 429 at call 41 within a minute, and a second token from the same IP is unaffected.
- `releaseUntexted`: releases a 20-minute-old seat with no `dm_route`; keeps a seat whose user texted after the seat was created; keeps a 5-minute-old untexted seat; keeps `DEMO_TEAM` seats.
- `/join` keys: `ensureSeat(user, \`join:${planId}\`)` produces the same idempotency key as today's `joinIdempotencyKey(planId, …)` (regression test).
- `/join`: `first_name` optional; `plan_full` at 8; `already_joined` true for JOINED; `sms_body` length rule; old `JOIN` clients still get `join_text`.
- `/plans`: organizer has a participant row at INVITED and a seat; response has `sms_href` and no `qr_svg`. The organizer's first text "Hey SquadTab! Let's get planning." → JOINED + T_JOIN_WELCOME + T_BUDGET_ASK (A2 test).
- `GET /plans/:code`: exact key set (no budget, no member names); 404.
- `GET /status`: all phases; 401 on a tampered or expired token; `texted` flips only after a `dm_routes.updated_at` later than `iat`.
- `users`: a blank first name never overwrites a real one.

**Agent, A2** (mock LLM)

- INVITED + "hey" → JOINED + T_JOIN_WELCOME_NAME.
- INVITED + "I'm out" → DECLINED.
- JOINED blank name + awaiting `"name"` + "leo" → name set + T_BUDGET_ASK_NAMED, and the flag is cleared.
- JOINED blank name + awaiting `"name"` + "40 max" → budget path.
- Chat-created organizer (blank name, no `"name"` flag) answers T_BUDGET_ASK with "maybe sixty" → budget path, name stays blank.
- `area` validation: "santa monica, $60 each", "310-555-0123" and "4111 1111 1111 1111" are rejected (→ T_START_ASK_AREA); "Westwood / Sawtelle" and "Koreatown" are accepted.
- `orgJoinStatusJob` with only the organizer JOINED sends nothing.
- No-ctx user: "Hey SquadTab! Help me plan a night out." → T_START_HELLO (assert no URL in the text). Then "maya, santa monica saturday, 4 of us" → plan created, organizer JOINED, T_PLAN_READY with `/j/` URL, then T_BUDGET_ASK.
- Missing area → T_START_ASK_AREA.
- Missing count → one ask, then default 4.
- Organizer GO works on a chat-created plan.
- `looksLikeName` and join-regex tables.

**Web, W1/W2**

- `smsHref` (iOS `&`, Android `?`, encoding of `'` and `!`).
- `detectPlatform` (iPhone, iPadOS-as-Mac, Android, Mac, Windows).
- `shareInvite` (share, abort, missing → copy).
- `statusPhase` reducer.
- Join error copy table.
- `next build` passes.

### 11.2 Live smoke (after deploy; costs seats, so release afterwards)

1. `/ops/release-seats`.
2. On a team iPhone not in `DEMO_TEAM`: open `/`, type the number, tap **Start in iMessage**, send, and walk through 5.1. Confirm the web flips waiting → texted → plan ready, and that the link in chat is tappable.
3. Share the invite to a second team iPhone via the share sheet. Open it, check the preview card, join, send, and walk through 5.2. Confirm the organizer page shows "2 of 4 in" (counts only, no names).
   - Also run the gate check: on a laptop, submit the second phone's number at `/` without texting from it. The status page must stay on "Hit send in Messages" and show no plan.
4. Judge path: `/j/4821` (seeded plan, `party_target` 4, 3 seeded members) on a fresh phone → joining and finishing preferences starts research automatically (`membership.ts onPrefsDone`).
5. `/ops/release-seats` again.

The demo-team phones are members of the seeded plan, so after texting from `/start` they land in that plan's stage handler, not in start-by-chat. Demo the organizer flow with a 4th phone, or after a reset that leaves that phone out. Between judges, use `/ops/release-untexted`. Use `/ops/release-seats` only during this smoke test or a full reset, never while a judge is mid-plan.

### 11.3 Device checklist (real iPhone on iOS 26, plus a Mac; record pass or fail in this file)

| | Check | If it fails |
|---|---|---|
| a | `sms:+1…&body=…` opens Messages with the body filled | Nothing to change: any text joins. Optionally drop the body. |
| b | Auto-open after `await fetch` (3.4) | Remove the auto-open line; keep the button. |
| c | `navigator.share` lists Messages threads, including group chats | Copy fallback already exists. |
| d | `autocomplete=tel` offers the phone's own number | Nothing to change. |
| e | `/j/[code]` shows a rich preview with the OG image in a group chat | Check that the crawler gets a 200 with og tags; add an icon. Expect the link in SquadTab's own DM to show "Tap to load preview", because iOS does not auto-load previews from unknown senders (UNVERIFIED on iOS 26). The preview matters in the group chat, where a friend forwards it. |
| f | QR scan of `/t/<token>` from a laptop → button → Messages | Nothing to change. |
| g | Link opened inside Instagram's in-app browser | Number and message copy fallback. |
| h | Mac Messages `sms:` sends from the phone number, not the Apple ID email | Keep the Mac link secondary with the caveat. |
| i | `POST /start` latency (undocumented); spinner stays under about 1.5 s | Keep "Getting your line…" copy. |
| j | Desktop `/j/4821` scan-first QR → phone opens `/j/4821` → join → send (the PLAN §15 judge beat) | Print the QR as a backup card at the booth. |
| k | Venue Wi-Fi: two phones on the same network poll `/status` at once for 2 minutes, with no 429 | Raise the per-IP ceiling. |

---

## 12. Open risks and UNVERIFIED items

- iOS `&body=` support and auto-navigation after `await` (11.3 a and b). The design does not depend on either.
- Assignment-create latency is undocumented. The client allows 10 s × 2 attempts (Photon agent finding); the web timeout is 15 s (`agentRequest.ts:7`).
- Plan drafts held in memory are lost on restart. That is the accepted trade-off tonight; a `plan_drafts` table is the follow-up.
- Implied consent via microcopy instead of a checkbox is the team's legal call. The flow is inbound-first: the user always sends the first message.
- The "tonight" wording in the frozen budget and preference copy (5.1 flag).
- A native contact card is not in the beta REST `SendContent` union, so Photon's "share a contact card early" advice is not doable on this stack tonight (re-checked: OpenAPI `components.schemas.SendContent`).
- Public plan preview on a 4-digit code is enumerable (section 7.2, accepted).
- Whether a link in the **first** outbound is tappable when the user texted first (section 8.3, accepted with a web fallback).
- Android/SMS senders on shared iMessage lines are undocumented; the Android block is a product choice (section 6).
- `/status` token minted for someone else's number passes the gate if the real owner texts within its TTL (section 7.2, accepted; exposure equals the public preview).

---

## 13. Verification notes (adversarial pass, 2026-10-18 00:15 PDT)

Method:
- Every Photon claim was re-read in the photon-docs MCP (beta pages and the mounted OpenAPI).
- Every code claim was checked against `foundation` at `e965b8a`.
- Every invariant was checked against CLAUDE.md and PLAN §4.
- Nothing was run against live Photon, because that would spend seats.

### (a) Photon feasibility: all core claims hold

| Claim | Result | Evidence |
|---|---|---|
| A shared line can't text first | Confirmed | `/beta/get-started/imessage` lines 16-17 |
| Only the assigned sender reaches the connection | Confirmed | same page, lines 35-37 |
| Phone and Apple-ID email are different senders | Confirmed | same page, lines 30-32 |
| Sends go only to an assigned peer who has messaged since the assignment; 403 `SHARED_LINE_NOT_ASSIGNED` / `SHARED_LINE_INBOUND_REQUIRED` | Confirmed | `/beta/api-reference/messages/send-a-message`; `/beta/problems/catalog` lines 319-320 |
| Assignment create is synchronous (201, `assignedPhoneNumber`), `firstName` optional | Confirmed | create-shared-line-assignment (201 example, Rust sample `first_name: None`) |
| Free = 25 shared assignments; no dedicated lines on Free/Pro | Confirmed | `/beta/plans-and-billing` lines 33-34, 64, 70 |
| No single public number on Free/Pro | Confirmed | `/spectrum-ts/providers/imessage/connection-and-routing` lines 79-80 |
| `sms:+1...&body=` deep links recommended | Confirmed | `/best-practices/imessage-deliverability` line 15 |
| 3 user messages → trusted | Confirmed | same page, line 18 |
| No links/media in the first message | Confirmed, but it is written for outbound-first; applicability to inbound-first is UNVERIFIED | same page, line 74 |
| Direct only, no groups | Confirmed. **Fixed citation**: it was "line 861", now the troubleshooting table | `/beta/get-started/imessage` |
| No contact card / rich link in beta REST | Confirmed | OpenAPI `SendContent` (13 members listed in section 1) |
| Android | **Not documented**. The doc now says the block is a product choice | `rg -i android /beta` → no match |
| Pacing | **Added**: max 2 bubbles per turn | deliverability line 63 |

### (b) Code feasibility and time

Wrong citations fixed:
- `seats.ts:195-214` / `:225`: the file is 73 lines. Now `seats.ts:29-48`, `:21-23` and `:59-73`.
- `schemas.ts:160`: now `packages/shared/src/index.ts:35` and `join/schemas.ts:29`.
- `JoinForm.tsx:206-207` described a regex that doesn't exist; the current check is `startsWith("sms:")`.
- Line 7's "uncommitted files" claim was stale (git status clean).

Verified correct: `route.ts:39/44/46-51/53-54/61-63/79`, `commands.ts:40`, `routes.ts:27/69/106-126`, `messaging.ts:86-92`, `dmRoutes.ts:6-14`, `templates.ts:87`, `agentRequest.ts:7`, `dev/inbound.ts:57`, `cors.ts:8`, `app.ts:29`.

Bugs in the design, now fixed:
1. **Name step would capture budget answers as names.** `first_name === ''` plus a loose `looksLikeName` meant a chat-created organizer answering T_BUDGET_ASK with "maybe sixty" became "Maybe". Now an explicit awaiting flag `"name"` (`awaiting.ts:3`) drives it, and the reject list has more words.
2. **`orgJoinStatusJob` now counts the organizer**, so `k = 1` would send "Reply GO to plan with the 1 of you". Guard changed to `k < 2` (`ladder.ts:51`).
3. **Deploy-order break.** Dropping `qr_svg` from `POST /plans` breaks the live web's `CreatePlanResponse` (`apps/web/lib/agent.ts:29`) if the agent deploys first. Now it is kept until the web ships.
4. **Seat-key regression risk** in the `ensureSeat` signature change. A test now pins `/join` keys to today's format.

Ownership gaps closed:
- `awaiting.ts`, `ports/llm.anthropic.ts` and `jobs/ladder.ts` → A2.
- `repo/assignments.ts` and `ops/routes.ts` → A1.
- `apps/web/package.json` (`qrcode@1.5.4`) and `lib/qr.ts` → W1.
- A single deploy integrator, because Vercel deploys on push to `main`.

Time:
- The original cut at 10:30 left one hour before the 11:30 deploy freeze (CLAUDE.md), which the doc never mentioned. The cut moved to 09:30, and wall-clock anchors were added.
- Scope added by this pass is small: `releaseUntexted`, the desktop QR, the `/status` gate and the per-token limiter. Each is under about 30 minutes.

### (c) Judge lens: where it was still clunky

- **Booth/judge path (Visa UX, Photon traction).** PLAN §15 has the judge scanning a QR to `/j/4821`, but the design only showed a QR *after* typing a phone number on the laptop. That is two devices and double entry. **Fixed:** desktop is now scan-first (QR of the page itself, no seat), with the field as a secondary option.
- **Seats running out mid-judging.** Each submit spends one of 25 seats, and the only tool, `/ops/release-seats`, would also cut off judges mid-plan. **Fixed:** `/ops/release-untexted`.
- **Venue Wi-Fi.** A 60/min per-IP limit on a 2 s poll would 429 the second judge on the same network. **Fixed:** per-token limit.
- **Organizer forwarding.** The URL is now alone on the last line of T_PLAN_READY. Tapping it lands on "This is your plan" with a one-tap share sheet. That is the cleanest path available without the rich-link and contact-card send types.
- **Copy accuracy.** "Cards are only held until everyone's in" was ambiguous and arguably wrong (holds persist until capture or release). It is now "nobody pays until everyone's in", which matches M4 and the product pitch.
- **Still true:** 3 interactions to the first text is the Free shared-line floor. Every remaining step is a platform constraint, and the doc says why.

### (d) Privacy and money invariants

- **New leak, found and fixed.** `/start` returned `in_plan` plus a plan preview, and `/status` returned plan details and friends' first names, all keyed on an **unverified** phone number. Anyone could type a stranger's number and see "Sat 7 PM, Santa Monica, with Leo and Sam". **Fixed:**
  - `/start` responses are uniform.
  - `/status` reveals plan data only after the number's owner texts (proof of possession via `dm_routes.updated_at >= iat`).
  - Member names are removed from the web.
- **P6 (CREAO gets no free text).** `area` now comes from LLM extraction over free text. Strict charset validation (no digits, `$`, `@`; card-number check) keeps budgets, phones and card numbers out of `ResearchBrief`.
- **P1/P2.** `parsePlanDraft` sees only the person's own text and own draft. `startByChat.ts` must stay off the `privacy.imports.test.ts` allowlist paths.
- **P3/P4.** All new outbound copy is templates. The off-topic fallback reuses the existing `converseReply` (`free.ts:83`), unchanged.
- **P8.** `/status` exposes stage-derived booleans only, never values.
- **M1-M9.** Untouched: no money path changes. `budget_usd` stays optional on `/join` (the form path into `privateConstraints` is unchanged). New copy passes the M9 banned-phrase list.

### Still UNVERIFIED (needs a device or a live call)

- iOS 26 `&body=` prefill.
- Auto-open after `await`.
- `navigator.share` listing group threads.
- `autocomplete=tel` self-fill.
- Unknown-sender link previews.
- Assignment-create latency.
- In-app browser `sms:` handling.
- Mac Messages send-from identity.
- Inbound-first link tappability.
- All are on the 11.3 checklist, and none blocks the flow.
