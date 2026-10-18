Home
Tech Stack
Schedule
About CREAO



&nbsp;

&nbsp;

&nbsp;

Hack with us



&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

LA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI Hackathon Starter Pack
Everything you need to architect, build, and deploy on CREAO and win a prize track.

Build it at the hackathon. Take it further with CREAO.

2026



&nbsp;

&nbsp;

&nbsp;

LA HACKS



HACK-ATHON

Fall

2026

A

I

​

Hacks

LA

October 17-18, 2026

James West Alumni Center (JWAC), UCLA



LA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSJoin the CREAO Prize TracksLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKS(Upgraded Account)0102Run out of credits? Message us in our Discord channel or come to the CREAO booth to request more credits. We top up hackers on request.RegisterSign up with this link to get an upgraded account for the hackathon:This grants you access with an upgraded account (Pro-level features, paid models, scheduled runs, and extra credits for the weekend).Register hereSubmit Your ProjectSubmit on the LA Hacks Devpost and select the CREAO track. Projects that don't select the track won't be judged for it.Submit here



HACK-ATHON

Fall

2026

A

I

​

Hacks

LA



LA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSThe One RequirementAt least one CREAO agent does the core work of your project.01Build that agent on agent.creao.ai. You can use more than one.02Build In your Devpost README, include a share link to one of the agent's runs and the agent ID (shown on its page).03Show the agent running in your demo.That's the whole rule. How you use CREAO beyond it is up to you.
LA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSThe Prize TracksLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSCREAO Launchpad: The Real PrizeOne rule for every track: a CREAO agent does the core work. Pick the track that fits.

01Best AI-First Disruptor — $2,000Remove the agent, and the product stops working.
Win if: your app runs on the agent's output, end to end.
Build with: API Trigger + webhooks, connectors, Browser Use, your own tools
02Best One-Person Company —$1,000One human operating like a funded startup.
Win if: you show an org chart of agents that hand work to each other.
Build with: one saved agent per role, coordinated by a scheduled /workflow (no code) or an orchestrator via API Trigger
03Best Team Empowerment — $500Agents as the connective tissue between people.
Win if: your agents make a team work better together without replacing anyone.
Build with: Slack, Teams or Notion connectors, scheduled runs, webhook handoffs



&nbsp;

&nbsp;

&nbsp;

&nbsp;

LAHACKS
2026

FALL

You built something promising. CREAO will help you take it beyond the hackathon.Every winning team is invited into CREAO Launchpad, our post-hackathon program for the next generation of builders. Instead of a one-time prize, Launchpad is continued investment in you and your project:
1 year of CREAO Pro Max ($1,440 value) — a full year of platform access to keep building and developing your product on CREAO, like a lightweight incubation period with continued platform support.

Product, technical, and founder mentorship — guidance to help turn your prototype into something real.

CREAO meet-and-greet — sit down with a successful founder/member of technical staffs, ask anything, and get direct advice on your journey.

Demo opportunities — showcase what you continue building after the event.

Launch support and amplification — when your project is launch-ready, CREAO helps amplify it through our community and content channels.

Career opportunities with CREAO — winning teams get interview opportunities. Yes, we're hiring.

30%AI as foundation25%Depth on CREAORemove the agent. Does the product stop working?What does the agent actually do? Did you extend it with your own tools, APIs, or agents, or call it from your product? We check the links in your README.20%Originality and ambitionIs this a new kind of product, or a chatbot wrapper?Does it clearly answer the track's question?15%Track fit10%Demo and storytellingThe live demo works, and the pitch names what CREAO is doing.



LA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSJudging CriteriaAt least one CREAO agent does the core work of your project.



&nbsp;

&nbsp;

LA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSKnow Before You BuildLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSLimits and Good Habits
Runs take minutes. Design for async work: show progress in your UI, and don't hold a request open waiting for a run. There's no live token streaming on the API Trigger.

Credits. Every run spends credits. An orchestrator that starts many agents spends many runs. Watch your balance, and don't let an agent start itself. If you run out, message us in the Discord channel or come to the CREAO booth for a top-up.

Keys stay on the server. Never put a capi\_ key in browser, mobile, or public repo code. Call the API from your backend.

Sandboxes are per conversation. Packages you install in chat stay for that conversation. Save them with Create Agent or Update Environment so every run has them. Saving is done in the agent.creao.ai interface; the API only runs agents.

Writes need permission. An agent that posts, sends, or edits in a connected app follows the agent's write setting. Set it to run automatically if your product needs unattended writes.



&nbsp;

&nbsp;

&nbsp;

LA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSFrom Your SideLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSHacker TipsPrototype in minutes.Sign up with the hackathon link, build your agent by chatting, save it with Create Agent, and make your first API call the same hour.Choose run modes intentionally.Use async runs with webhooks or polling for multi-step background work; keep your UI responsive while the agent works.Leverage multi-agent orchestration.Coordinate specialized role agents through the API Trigger, with keys stored in Secrets and conversation continuity via threadId.Secure keys server-side.Always proxy API requests through your backend. Never expose credentials in client-side web or mobile code.Answer the rubric question in your pitch.Say out loud: "Remove the agent, and this product dies." Then prove it in the demo.



&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

LA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI Hackathon Starter PackYour project shouldn't end when the hackathon does. Winning teams are invited into CREAO Launchpad, our post-hackathon program designed to help promising builders turn a hackathon prototype into something real. Win more than a hackathon. Keep building with CREAO.2026



&nbsp;

&nbsp;

Build with us



&nbsp;

&nbsp;

&nbsp;

Home

How to join
One requirement
Prize tracks
Judging Criteria
Tips
Tech

Tech Stack
The schedule

Schedule
About us

About CREAO
Documentation

Quickstart
Agents
API Trigger
Saving packages
Skills and connectors
Secrets
Browser Use
Workflows
Scheduled runs
How the sandbox works
Workspace
Memory
CREAO



&nbsp;

HACKS 2026

AI

Hackathon

LA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI Hackathon Starter Pack




Home
Tech Stack
Schedule
About CREAO







LA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSTech Stack
Build a product where the agent does the work.

Build it at the hackathon. Take it further with CREAO.

CREAO is an AI agent platform. At agent.creao.ai you build an agent by chatting with it, give it tools, and save it. That agent can then run on a schedule, work alongside your team, or be called from your own code. This pack covers everything you need to build on it and compete in the three CREAO prize tracks.

Winners are invited to CREAO Launchpad, our program for taking hackathon projects further.

The one requirement

At least one CREAO agent does the core work of your project.
Build that agent on agent.creao.ai. You can use more than one.
In your Devpost README, include a share link to one of the agent's runs and the agent ID (shown on its page).
Show the agent running in your demo.
That's the whole rule. How you use CREAO beyond it is up to you. The next section shows the three ways to go deeper.

How you build on CREAO

Three ways to plug your code in
Every CREAO agent runs in its own Linux sandbox with internet access. You can extend it in any combination of these three ways.

A · Agent as an API

Call your agent from your product
Every agent can be triggered over HTTPS. Your backend starts a run and gets the result back through a webhook or by polling. Your app handles the UI and data, and the agent handles the work.

POST /api/v1/runs
Webhook or polling
Continue a conversation with threadId
Attach up to 10 files per run
B · Tools in the sandbox

Give the agent new abilities
Write a CLI or script and install it into the agent's sandbox. Either save it with the agent, or publish it as a skill on GitHub so any agent can use it.

pip / npm packages saved with the agent
A SKILL.md repo installed from GitHub
Your own binaries and scripts
C · Your services + Secrets

Connect your own APIs
Deploy your own API or use a sponsor's, and save its key in CREAO's secret manager. The agent can then call that service securely.

Secret manager: Secrets in the sidebar
Your backend, sponsor APIs, any HTTP service
Tech stack

How the pieces connect
Your product sits on the left. The CREAO agent runs in the middle, in its sandbox. Everything outlined in blue is something you build.

YOUR PRODUCT
Frontend
web, mobile, bot, extension
Your backend
holds the API key
POST /api/v1/runs
/creao-callback
AGENT.CREAO.AI
API Trigger
runs · status · result · webhook
YOUR AGENT · IN ITS SANDBOX
Agent instructions + model
built by chatting, saved with Create Agent
Your tools
CLI packages
skills from GitHub
scripts, binaries
Your secrets
stored in Secrets
secret manager
Built-in tools
web search · web fetch · connectors · Browser Use
image, video, speech · slides · schedules
/workflow · memory · dashboards
THE INTERNET
Your APIs
and sponsor APIs
The web + apps
web search
web fetch
websites (Browser Use)
Gmail, Slack, Notion
Other CREAO
agents
optional: orchestrate
start
run
webhook
result
You build it
CREAO provides it
Async result or optional call
Getting started

From zero to your first API run
01

Sign up at agent.creao.ai and send your account email to the CREAO booth. We upgrade every registered hacker to Pro Plus with extra credits for the weekend.

02

Build the agent by chatting. Describe the task, connect the services it needs, and let it run until the result is right. Install any packages or tools it needs in the same chat.

03

Click Create Agent. This saves the workflow, an input form, and the sandbox environment, including anything you installed. Every future run starts from this state.

04

Store your keys. Save API keys for your own services in the secret manager (Secrets). The agent can use them without you pasting them into chat.

05

Create an API key. Either kind works. An account key from Settings → API Keys can run any of your agents. An agent key from an agent's own page runs only that agent. Both start with capi\_. Keep them on your server.

06

Call it from your backend with the examples below, then build your product around the result.

API reference

The API Trigger
Base URL https://agent.creao.ai. Authenticate with Authorization: Bearer capi\_…. Runs usually take a few minutes, so start one, then wait for the webhook or poll.

Key	Where to create it	What it can run	Best for
Account key	Settings → API Keys	Any agent your account can open	Apps that call several agents, and orchestrators
Agent key	The agent's own page	Only that agent. Any other returns APP\_SCOPE\_RESTRICTED.	Apps that call one agent, and keys an agent stores for calling others
Both keys work on both run routes, and either is fine for your submission. Every run has to name an agent, so there is no call without an appId. To send free-form prompts, create one general agent with a single prompt input and call it with "inputs": { "prompt": "…" }.

Route	Use it for
POST /api/v1/runs	Start a run. The agent goes in the body as appId. Returns 202 with a run id.
POST /api/v1/apps/{appId}/runs	Same, with the agent in the URL instead of the body.
GET /api/v1/runs/{id}	Status and result. Poll until completed, failed, or cancelled.
GET /api/v1/runs	List runs. Filter with status, limit, offset.
POST /api/v1/runs/{id}/cancel	Cancel a run.
Start a run

curl -X POST https://agent.creao.ai/api/v1/runs \\
  -H "Authorization: Bearer $CREAO\_API\_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "appId": "YOUR\_AGENT\_ID",
    "inputs": { "company": "Acme Robotics", "depth": "detailed" },
    "webhookUrl": "https://your-app.example/creao-callback?token=RANDOM\_SECRET",
    "idempotencyKey": "order-1842-research"
  }'

# → 202 { "id": "RUN\_ID", "status": "pending", "appId": "…", "appName": "…" }
Field	What it does
appId	Which agent to run, shown on the agent's page. Required on /api/v1/runs.
inputs	Values for the agent's input form, as a JSON object.
webhookUrl	Public https URL that receives the result. Optional.
threadId	Continue a previous run's conversation, so the agent remembers earlier turns. Use the threadId from an earlier result.
idempotencyKey	Safe retries: sending the same key again returns the same run instead of starting a new one. 8–128 characters.
chatModelId	Request a specific model. Limited by the account's plan.
files	Send multipart/form-data instead of JSON to attach up to 10 files (10 MB each). inputs then goes as a JSON string.
What the webhook receives, and what polling returns in result

{
  "runId": "RUN\_ID",
  "status": "completed",
  "threadId": "THREAD\_ID",
  "result": {
    "text": "…",
    "chatText": "…",
    "artifacts": \[
      { "id": "…", "title": "report.pdf", "type": "file", "url": "https://…" }
    \]
  }
}
Verify every webhook
Webhooks aren't signed. When one arrives, fetch GET /api/v1/runs/{runId} with your key and trust that response. A random token in the callback URL adds a second check.

Expect duplicates and gaps
We try delivery up to 3 times. De-duplicate on runId, and poll any run that's been pending unusually long.

Local dev needs a tunnel
Webhooks can't reach localhost or private IPs. Use ngrok or cloudflared, or deploy your callback endpoint.

Debug in the UI
Every API run appears as a normal conversation in your agent.creao.ai sidebar, titled \[API\] …, so you can watch what the agent did step by step.

Extending the agent

Tools and secrets, in practice
Save a CLI with an agent

In chat, ask the agent to install your tool (for example, pip install your-cli), confirm it works, then click Create Agent. To change an existing agent, use Update Environment on its page, install, then Save to Agent.

Packages installed during a normal run are not saved back. Only Create Agent and Update Environment save the environment.

Publish a skill on GitHub

A skill is a public repo (or folder) with a SKILL.md that tells the agent when and how to use your tool, plus any scripts it needs. Paste the URL into Skills → Install from GitHub, or ask the agent in chat to install it.

Skills work in every chat and agent on your account, not just one.

Keys for your own services go in the secret manager (Secrets, see the Secrets docs). Use keys made for your hackathon project, never a personal or production key.

Documentation

Where to read more
Quickstart
getting-started/quickstart
Agents: create, run, inputs
features/agents
API Trigger
pro/api-trigger
Saving packages with an agent
pro/agent-runtime-environment
Skills and connectors
features/skills-and-connectors
Secrets
features/secrets
Browser Use
features/browser-use
Workflows
features/workflows
Scheduled runs
features/scheduled-runs
How the sandbox works
pro/sandbox-lifecycle
Workspaces
features/workspaces
Memory
features/memory









Home

How to join
One requirement
Prize tracks
Judging Criteria
Tips
Tech

Tech Stack
The schedule

Schedule
About us

About CREAO
Documentation

Quickstart
Agents
API Trigger
Saving packages
Skills and connectors
Secrets
Browser Use
Workflows
Scheduled runs
How the sandbox works
Workspace
Memory
CREAO






HACKS 2026

AI

Hackathon

LA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI HACKATHONAI HACKATHONLA HACKSLA HACKSAI Hackathon Starter Pack