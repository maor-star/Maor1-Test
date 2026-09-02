# The Copilot, and connecting Gemini

The Copilot screen (`/copilot`) is a conversation with a model over the
cockpit's own data, plus the autopilot's daily decision log. The model never
sees the database: it sees tools — "the control panel", "the deals needing
attention", "open a task" — and every tool is a function in `lib/copilot/tools.ts`
that reads through the same modules the screens read and writes through the
same mutations, with the same audit rows and the same undo bar.

Two models can answer. Claude is the default because its key is already on the
server. Gemini is available the moment its key is set; the model picker on the
screen and the autopilot's "Model" dial choose between them, and `auto` takes
whichever is configured (Claude first, or `COPILOT_PROVIDER=gemini` to prefer
Gemini).

## Getting a Gemini API key

1. Go to **Google AI Studio**: https://aistudio.google.com/apikey — sign in with
   the Google account that should own the billing (the company Workspace
   account is the sensible choice).
2. Press **Create API key**. Pick an existing Google Cloud project or let it
   create one. The key starts with `AIza…`.
3. Billing: the free tier works for testing. For daily use, enable billing on
   that Cloud project (AI Studio → the project link → Billing), or the key will
   hit the free-tier rate limits during the morning review. Pricing is on
   https://ai.google.dev/pricing — the cockpit uses `gemini-2.5-pro` by default;
   set `COPILOT_GEMINI_MODEL=gemini-2.5-flash` for a cheaper, faster model.
4. Restrict the key (recommended): in Google Cloud Console → APIs & Services →
   Credentials → the key → **API restrictions** → only *Generative Language API*.

Never paste the key into chat, a mail, or the repository. It goes onto the
server only, through the step below.

## Putting the key on the server

From a machine with AWS access to the account (the same one deploys run from):

```bash
cd adnimation-cockpit
GEMINI_API_KEY='AIza…' node deploy/set-secret.mjs GEMINI_API_KEY
```

`set-secret.mjs` moves the value to the instance without it ever appearing in
an SSM command, a shell history line or a log. The app reads `.env` at start,
so restart it afterwards:

```bash
node deploy/ssm.mjs 'systemctl restart cockpit'
```

Then open `/copilot`: the header says *ANSWERING WITH CLAUDE* or *GEMINI*, and
the model picker beside the message box lets you switch per conversation.

Optional knobs, set the same way:

| Variable | Default | What it does |
|---|---|---|
| `COPILOT_PROVIDER` | `anthropic` | Which model `auto` prefers when both keys exist |
| `COPILOT_GEMINI_MODEL` | `gemini-2.5-pro` | Gemini model name |
| `COPILOT_ANTHROPIC_MODEL` | `claude-sonnet-5` | Claude model name |

## What the copilot may do

Read anything the cockpit knows. Act on anything reversible inside it: open a
task, raise an alert, note a deal, move a deal's stage, switch another agent on
or off. It cannot send mail, sign, pay, or touch anything outside the cockpit,
and the Ad Ops Architect source is read-only to it as to everything else.

## The autopilot

The `autopilot` agent on the agents screen runs the daily review. Its autonomy
level decides whether its decisions are *done* or only *proposed* (level 1:
everything waits for you on the Copilot screen; level 2 and up: the kinds
ticked under "What it may do on its own" are carried out and logged). Its
dials set the hour, the model, the scope and the cap on decisions per review.
Like every agent it starts at level 1, off, and needs twenty runs before it
can be promoted.
