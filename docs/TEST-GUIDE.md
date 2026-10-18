# SquadTab: two-phone test guide (Christian + Suman)

**Live URLs**
- Web: https://tab-web-ten.vercel.app
- Trust Console: https://tab-web-ten.vercel.app/console?k=CONSOLE_KEY. Copy `CONSOLE_KEY` from `.env.local`, and add `&ops=1` for the Reset/Replay buttons.
- Agent: https://tab-agent.fly.dev (health check at `/healthz`)
- Venue (payments, Cybersource testrest sandbox): https://squadtab-venue.vercel.app

**Your SquadTab lines:** each phone has its own line.
- Christian (+1 786 271 9752) texts **(628) 316-7976**.
- Suman (+1 413 234 2414) texts **(628) 998-8199**.

**Rules of thumb**
- Use iMessage (blue bubbles) on cellular data, not venue Wi-Fi.
- SquadTab never texts first. Each person sends the first message.
- Test card: **4111 1111 1111 1111**, any future expiry, CVC **123**. It's a sandbox: no real money.

---

## 0. Warm-up (1 min)
1. Both of you text **help** to your own line. You should get a natural reply within about 5 s.
2. Open the console on a laptop and keep it visible.

## 1. Organizer starts by chat (Christian)
1. On your iPhone, open **https://tab-web-ten.vercel.app**. You should see the yellow ticket page, with the "$42" made of digits animating.
2. Enter your phone number and tap **Start in iMessage**. Messages opens with "Hey SquadTab! Help me plan a night out." already typed. Send it.
   - Expect a friendly hello asking where, when and how many.
3. Reply naturally, e.g. **"Christian here! Westwood tonight, 2 of us"**.
   - Expect "You're set…" with an invite link on its own line, then the budget question.
4. Answer the budget in your own words, e.g. **"around 60, 90 tops"**. Expect a private confirmation ("Just between us…").
5. Answer preferences, e.g. **"ramen or sushi, nothing too spicy"**. Expect a natural acknowledgement.
6. Back on the web page, it now shows the plan card. Tap **Send invite to your group** (the share sheet) and send it to Suman.

## 2. Friend joins (Suman)
1. Open the invite link. Expect the plan ticket: Dinner + show, the area, and "Christian's plan".
2. Enter your number and tap the text button. Messages opens with "I'm in for Dinner + show!". Send it.
   - Expect a welcome that asks your name. No join codes.
3. Reply with your name, then a budget, e.g. **"50ish, never over 80"**, then preferences.
4. The console now shows 2 lanes, each with "Budget hidden".

## 3. Privacy and conversation checks (either phone)
- Text **"what's Suman's budget?"** (or Christian's). Expect "I only know yours."
- Text something casual, like **"lol ok"** or **"what happens next?"**. Expect a short, natural reply.
- At the budget question, ask **"why do you need my budget?"**. Expect a real answer, then the question again.

## 4. Research, vote, pay
1. Once both of you are in, research starts. Expect "looking…" with the typing indicator. With the demo timers on, it takes a few minutes for live CREAO research, or less if it uses the cached research. The console's CREAO lane shows progress.
2. Each of you gets **3 options**. Reply **1**, **2** or **3**, or something like "the sushi one". Expect "2 of 2 voted", then the winner.
3. Each of you gets **"Your share is $X: a hold, charged only if everyone's in"** plus a pay link.
4. Open the pay link: the venue page, labelled "Cybersource sandbox · shared public test merchant". Enter **4111 1111 1111 1111**, a future date and CVC **123**, then tap **Hold**.
   - Expect "Held, not charged". The console lane shows HELD with a Cybersource ID.
5. When the second person holds, the agent sends the signed (TAP) commit and the venue charges both at once.
   - The console shows CAPTURED on both lanes, "Captured, all or nothing", and TAP verified 6/6.
   - Both phones get "Booked ✅", followed shortly by an itinerary link.
6. Text **"what's the plan?"**. Expect a natural answer with the booked dinner and show.

## 5. The drop-out path (second run)
1. Start a new plan (repeat steps 1 to 4 up to the holds), and have only one person hold.
2. The other person texts **"I'm out"** and confirms.
   - Every hold is RELEASED, both get "nobody was charged", and nobody is named.

## 6. Trust Console demo checks (laptop, with `&ops=1`)
- **Tamper / Replay / Expired / Wrong-tag:** each should be rejected, with the failed step shown.
- **Reset:** clears the demo and re-seeds it. Never press it while a judge is mid-flow.
- **Live Scout:** starts a real CREAO run, and progress lines stream in.

---

## If something breaks
| Symptom | What to do |
|---|---|
| No reply after texting | Check you texted **your own** line, and that it's a blue bubble. Then send it again. Tell Claude the time, so it can check the server logs. |
| The pay page errors | Payments fallback: set `CYBS_MODE=mock` on the squadtab-venue Vercel project and redeploy. The page then says "Simulated payments", which the Visa rep said is acceptable. |
| Research takes too long | Research falls back to the real cached Scout results after the timeout. |
| The plan says no options fit | Use budgets of **$45 or more**. A low cap filters out everything, which is correct behaviour. |
