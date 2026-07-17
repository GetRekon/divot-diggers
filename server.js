const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const COURSES = require('./courses');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function defaultState() {
  return {
    version: 1,
    players: [],
    rounds: [
      {
        id: 'r1',
        name: 'Round 1',
        course: 'magenta',
        mode: 'ambrose',
        teams: [],
        mysteryHole: null
      },
      {
        id: 'r2',
        name: 'Round 2',
        course: 'shelly',
        mode: 'stroke',
        teams: [],
        mysteryHole: null
      }
    ],
    // scores[roundId][playerId][hole] = strokes
    scores: {}
  };
}

let state;
function load() {
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    state = defaultState();
    save();
  }
}
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function touch() {
  state.version = (state.version || 0) + 1;
  save();
}
load();

function requester(req) {
  const pid = req.get('x-player-id') || req.query.pid;
  return state.players.find(p => p.id === pid) || null;
}
function hasAdmin() {
  return state.players.some(p => p.isAdmin);
}
function requireAdmin(req, res) {
  if (!hasAdmin()) return true; // nobody has joined yet — allow bootstrap
  const p = requester(req);
  if (p && p.isAdmin) return true;
  res.status(403).json({ error: 'Only the trip organiser can do that' });
  return false;
}

/* Hole coverage per scoring entity (team = union of member scores) */
function roundEntities(r) {
  if (r.mode === 'ambrose' && (r.teams || []).length) {
    return r.teams.map(t => t.playerIds);
  }
  return state.players.map(p => [p.id]);
}
/* Round counts as finished when everyone who started has all 18 holes in */
function roundComplete(r) {
  const rs = state.scores[r.id] || {};
  let anyStarted = false;
  for (const pids of roundEntities(r)) {
    const holes = new Set();
    for (const pid of pids) {
      for (const h of Object.keys(rs[pid] || {})) holes.add(h);
    }
    if (holes.size > 0) {
      anyStarted = true;
      if (holes.size < 18) return false;
    }
  }
  return anyStarted;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/state', (req, res) => {
  const p = requester(req);
  const isAdmin = !!(p && p.isAdmin);
  // hide the mystery hole from non-organisers until the round is done
  const rounds = state.rounds.map(r => {
    const revealed = !!r.mysteryRevealed || roundComplete(r);
    const out = { ...r, mysteryHoleSet: r.mysteryHole != null, mysteryVisible: revealed };
    if (!isAdmin && !revealed) out.mysteryHole = null;
    return out;
  });
  res.json({
    state: { ...state, rounds },
    courses: COURSES,
    you: p ? { id: p.id, isAdmin } : null
  });
});

app.post('/api/players', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 30);
  if (!name) return res.status(400).json({ error: 'Name required' });
  let player = state.players.find(
    p => p.name.toLowerCase() === name.toLowerCase()
  );
  if (!player) {
    player = { id: crypto.randomUUID().slice(0, 8), name };
    state.players.push(player);
  }
  // first person in becomes the trip organiser
  if (!hasAdmin()) player.isAdmin = true;
  touch();
  res.json({ player });
});

app.delete('/api/players/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = req.params.id;
  state.players = state.players.filter(p => p.id !== id);
  for (const roundId of Object.keys(state.scores)) {
    delete state.scores[roundId][id];
  }
  for (const round of state.rounds) {
    for (const team of round.teams || []) {
      team.playerIds = team.playerIds.filter(pid => pid !== id);
    }
  }
  touch();
  res.json({ ok: true });
});

app.post('/api/scores', (req, res) => {
  const { roundId, playerId, hole, strokes } = req.body;
  const round = state.rounds.find(r => r.id === roundId);
  const player = state.players.find(p => p.id === playerId);
  const h = Number(hole);
  if (!round || !player || !(h >= 1 && h <= 18)) {
    return res.status(400).json({ error: 'Invalid round, player or hole' });
  }
  if (!state.scores[roundId]) state.scores[roundId] = {};
  if (!state.scores[roundId][playerId]) state.scores[roundId][playerId] = {};
  if (strokes === null || strokes === undefined || strokes === '') {
    delete state.scores[roundId][playerId][h];
  } else {
    const s = Number(strokes);
    if (!(s >= 1 && s <= 20)) {
      return res.status(400).json({ error: 'Strokes must be 1-20' });
    }
    state.scores[roundId][playerId][h] = s;
  }
  touch();
  res.json({ ok: true, version: state.version });
});

app.post('/api/rounds/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const round = state.rounds.find(r => r.id === req.params.id);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const { mode, teams, mysteryHole, mysteryRevealed, name } = req.body;
  if (mode === 'stroke' || mode === 'ambrose') round.mode = mode;
  if (Array.isArray(teams)) {
    round.teams = teams
      .map(t => ({
        id: t.id || crypto.randomUUID().slice(0, 8),
        name: String(t.name || 'Team').trim().slice(0, 30),
        playerIds: Array.isArray(t.playerIds)
          ? t.playerIds.filter(pid => state.players.some(p => p.id === pid))
          : []
      }))
      .filter(t => t.playerIds.length > 0 || t.name);
  }
  if (mysteryHole !== undefined) {
    const mh = mysteryHole === null ? null : Number(mysteryHole);
    round.mysteryHole = mh >= 1 && mh <= 18 ? mh : null;
  }
  if (mysteryRevealed !== undefined) round.mysteryRevealed = !!mysteryRevealed;
  if (typeof name === 'string' && name.trim()) round.name = name.trim().slice(0, 40);
  touch();
  res.json({ round });
});

app.post('/api/rounds/:id/clear-scores', (req, res) => {
  if (!requireAdmin(req, res)) return;
  delete state.scores[req.params.id];
  touch();
  res.json({ ok: true });
});

app.get('/api/export', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.setHeader('Content-Disposition', 'attachment; filename="divot-diggers-data.json"');
  res.json(state);
});

app.listen(PORT, () => {
  console.log(`Divot Diggers running on port ${PORT}`);
});
