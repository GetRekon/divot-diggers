# Divot Diggers ⛳

Live golf scoring and leaderboard for the Divot Diggers trip — Magenta Shores (par 72) and Shelly Beach (par 71), Central Coast NSW. Real hole-by-hole par, stroke index and distances are built in.

## What it does

- **Join with just a name** — each player opens the site on their phone, types their name once, and starts scoring. Their identity is remembered on their device.
- **Score entry** — tap a hole, tap your score (quick buttons around par, or +/−), save & it auto-advances to the next hole.
- **Live leaderboard** — updates within ~4 seconds every time anyone posts a score. Per-round tabs plus a "Whole Trip" combined standing.
- **Ambrose mode** (Round 1 default) — build teams in Setup; the team's score on each hole is the **best score entered** by any member. Players who pick up just leave the hole blank.
- **Analytics** — mystery prize hole winner 🎁, scoring breakdown bars (eagles → doubles), hardest/easiest holes, hot streaks, blow-ups, most consistent player, back-nine surges.
- **Setup page** — switch each round between stroke/Ambrose, build teams, set (or 🎲 roll) the mystery prize hole, clear scores, remove players, download a JSON backup.

## Run locally

```
npm install
npm start          # http://localhost:3000
```

All data lives in `data/data.json` (created automatically). Delete that file to reset everything to a blank slate.

## Deploy (Railway — recommended)

The app is one small Node server, so it needs a host that runs a process (not static/serverless — Vercel's serverless functions can't keep the score file). Railway fits perfectly:

1. Push this folder to a GitHub repo (or `railway init` in this folder with the Railway CLI).
2. Create a new Railway project from that repo — it auto-detects Node and runs `npm start`.
3. **For score persistence across redeploys**: add a Volume in Railway, mount it at `/data`, and set the environment variable `DATA_DIR=/data`. (Without this, scores survive restarts but are wiped by a redeploy — fine if you don't push code mid-round.)
4. Generate a public domain in Railway settings and share the URL with the group.

Render.com works the same way (Web Service + Disk mounted at `/data`, `DATA_DIR=/data`).

## Before the trip

- The local `data/data.json` currently contains **demo players and scores** (Jack, Benno, Sticks, Wardy) from testing — delete `data/data.json` (or use Setup → clear scores / remove players) before real play. A fresh deployment starts empty anyway.
- In Setup: pick the format for each round, build the Ambrose teams once everyone has joined, and roll the mystery prize holes.

## Notes

- No accounts or passwords — it's a trusted-friends app. Anyone with the URL can score.
- Scores allowed: 1–20 per hole. Blank = no score (picked up).
- Course data sourced from published scorecards (18Birdies), distances in metres from the championship tees.
