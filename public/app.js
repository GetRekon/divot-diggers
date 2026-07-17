/* Divot Diggers — live golf scoring */

let S = null; // { state, courses }
let me = JSON.parse(localStorage.getItem('dd_me') || 'null');
let currentView = me ? 'score' : 'join';
let currentRoundId = localStorage.getItem('dd_round') || 'r1';
let lbRoundId = null; // leaderboard tab ('trip' or roundId)
let statsRoundId = null;
let modalHole = null; // hole open in score modal
let modalStrokes = null;
let setupDirty = false;
let lastVersion = -1;

const $view = document.getElementById('view');
const $nav = document.getElementById('nav');
const $whoami = document.getElementById('whoami');
const $backdrop = document.getElementById('modal-backdrop');
const $modal = document.getElementById('modal');
const $toast = document.getElementById('toast');

/* ---------------- api ---------------- */

async function api(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers, me ? { 'x-player-id': me.id } : {});
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed');
  }
  return res.json();
}

async function post(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function fetchState() {
  try {
    const data = await api('/api/state');
    const changed = !S || data.state.version !== lastVersion;
    S = data;
    lastVersion = data.state.version;
    if (changed) renderIfSafe();
  } catch (e) {
    /* offline blip — keep last state */
  }
}

function renderIfSafe() {
  // don't clobber the score modal or in-progress setup edits
  if (!$backdrop.hidden) return;
  if (currentView === 'setup' && setupDirty) return;
  render();
}

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { $toast.hidden = true; }, 1800);
}

function round(id) { return S.state.rounds.find(r => r.id === id); }
function amAdmin() {
  if (!me) return false;
  const p = S.state.players.find(p => p.id === me.id);
  return !!(p && p.isAdmin);
}
function course(r) { return S.courses[r.course]; }
function playerName(id) {
  const p = S.state.players.find(p => p.id === id);
  return p ? p.name : '?';
}
function myScores(roundId) {
  return (S.state.scores[roundId] || {})[me.id] || {};
}
function fmtToPar(n) {
  if (n === 0) return 'E';
  return n > 0 ? '+' + n : String(n);
}
function toParClass(n) {
  return n < 0 ? 'under' : n > 0 ? 'over' : 'level';
}
function scoreClass(strokes, par) {
  const d = strokes - par;
  if (d <= -2) return 'eagle';
  if (d === -1) return 'birdie';
  if (d === 0) return 'par';
  if (d === 1) return 'bogey';
  return 'double';
}
const SCORE_NAMES = { eagle: 'Eagle 🦅', birdie: 'Birdie 🐦', par: 'Par', bogey: 'Bogey', double: 'Double+' };

/* Entities a round is scored for: teams in ambrose (when teams exist), else players */
function entitiesForRound(r) {
  if (r.mode === 'ambrose' && (r.teams || []).length) {
    return r.teams.map(t => ({
      id: t.id,
      name: t.name,
      members: t.playerIds.map(playerName),
      playerIds: t.playerIds,
      isTeam: true
    }));
  }
  return S.state.players.map(p => ({ id: p.id, name: p.name, playerIds: [p.id], isTeam: false }));
}

/* Best (lowest) entered score for the entity on a hole, or null */
function entityHoleScore(r, entity, hole) {
  const rs = S.state.scores[r.id] || {};
  let best = null;
  for (const pid of entity.playerIds) {
    const s = (rs[pid] || {})[hole];
    if (s != null && (best === null || s < best)) best = s;
  }
  return best;
}

/* Per-entity line for a round */
function computeLine(r, entity) {
  const holes = course(r).holes;
  let strokes = 0, toPar = 0, thru = 0;
  const perHole = {};
  for (const h of holes) {
    const s = entityHoleScore(r, entity, h.hole);
    if (s != null) {
      perHole[h.hole] = s;
      strokes += s;
      toPar += s - h.par;
      thru++;
    }
  }
  return { entity, strokes, toPar, thru, perHole };
}

function roundLeaderboard(r) {
  return entitiesForRound(r)
    .map(e => computeLine(r, e))
    .filter(l => l.thru > 0)
    .sort((a, b) => a.toPar - b.toPar || b.thru - a.thru || a.strokes - b.strokes);
}

/* ---------------- render dispatch ---------------- */

function setView(v) {
  currentView = v;
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (!S) return;
  const joined = !!me;
  $nav.hidden = !joined;
  $whoami.hidden = !joined;
  if (joined) $whoami.textContent = me.name;
  $nav.querySelector('[data-view="setup"]').hidden = !amAdmin();
  if (currentView === 'setup' && !amAdmin()) currentView = 'score';
  $nav.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === currentView)
  );
  if (!joined) currentView = 'join';
  const views = { join: renderJoin, score: renderScore, leaderboard: renderLeaderboard, stats: renderStats, setup: renderSetup };
  (views[currentView] || renderJoin)();
}

/* ---------------- join ---------------- */

function renderJoin() {
  const existing = S.state.players;
  $view.innerHTML = `
    <div class="join-hero">
      <div class="big">🏌️</div>
      <h2>Welcome to the trip</h2>
      <p class="hint">Enter your name to start scoring.<br>Magenta Shores &amp; Shelly Beach await.</p>
    </div>
    <div class="card">
      <h2>I'm new here</h2>
      <div class="field"><input id="join-name" placeholder="Your name" maxlength="30" autocomplete="off"></div>
      <button class="btn" id="join-btn">Let's dig some divots ⛳</button>
    </div>
    ${existing.length ? `
    <div class="card">
      <h2>Already joined? Tap your name</h2>
      <div class="player-pick">
        ${existing.map(p => `<button class="chip" data-pid="${p.id}">${esc(p.name)}</button>`).join('')}
      </div>
    </div>` : ''}
  `;
  const join = async name => {
    if (!name.trim()) return;
    try {
      const { player } = await post('/api/players', { name });
      me = player;
      localStorage.setItem('dd_me', JSON.stringify(me));
      await fetchState();
      setView('score');
      toast(`Welcome, ${player.name}!${player.isAdmin ? ' You’re the organiser 👑' : ''}`);
    } catch (e) { toast(e.message); }
  };
  document.getElementById('join-btn').onclick = () => join(document.getElementById('join-name').value);
  document.getElementById('join-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') join(e.target.value);
  });
  $view.querySelectorAll('[data-pid]').forEach(b => {
    b.onclick = async () => {
      const p = S.state.players.find(p => p.id === b.dataset.pid);
      const { player } = await post('/api/players', { name: p.name });
      me = player;
      localStorage.setItem('dd_me', JSON.stringify(me));
      await fetchState();
      setView('score');
      toast(`Welcome back, ${player.name}!`);
    };
  });
}

/* ---------------- score entry ---------------- */

function roundChips(selectedId, onPick, extra = []) {
  const items = [...S.state.rounds.map(r => ({ id: r.id, label: `${r.name} · ${course(r).name}` })), ...extra];
  return `<div class="chips">${items.map(i =>
    `<button class="chip ${i.id === selectedId ? 'active' : ''}" data-rid="${i.id}">${esc(i.label)}</button>`
  ).join('')}</div>`;
}

function bindChips(onPick) {
  $view.querySelectorAll('[data-rid]').forEach(b => { b.onclick = () => onPick(b.dataset.rid); });
}

function renderScore() {
  const r = round(currentRoundId) || S.state.rounds[0];
  currentRoundId = r.id;
  const c = course(r);
  const scores = myScores(r.id);
  const line = computeLine(r, { playerIds: [me.id] });
  const myTeam = (r.teams || []).find(t => t.playerIds.includes(me.id));

  const holeCard = h => {
    const s = scores[h.hole];
    const cls = s != null ? scoreClass(s, h.par) : '';
    return `<button class="hole-card ${cls}" data-hole="${h.hole}">
      <div class="num">HOLE ${h.hole}</div>
      <div class="score ${s == null ? 'empty' : ''}">${s != null ? s : '·'}</div>
      <div class="par">Par ${h.par} · ${h.metres}m</div>
    </button>`;
  };
  const front = c.holes.slice(0, 9), back = c.holes.slice(9);

  $view.innerHTML = `
    ${roundChips(r.id)}
    <div class="round-banner">
      <div>
        <div class="title">${esc(c.name)}</div>
        <div class="meta">${esc(c.location)} · Par ${c.holes.reduce((a, h) => a + h.par, 0)} · ${esc(c.tees)}</div>
      </div>
      <span class="mode-tag">${r.mode === 'ambrose' ? '🤝 Ambrose' : '🏌️ Stroke'}</span>
    </div>
    ${r.mode === 'ambrose' ? `<div class="ambrose-note">
      <strong>Ambrose round:</strong> the team takes the <strong>best score entered</strong> on each hole.
      ${myTeam ? `You're on <strong>${esc(myTeam.name)}</strong>.` : 'No team yet — sort teams in Setup.'}
      Picked up your ball? Just leave the hole blank.
    </div>` : ''}
    <div class="score-summary">
      <div><div class="v">${line.thru}</div><div class="l">Thru</div></div>
      <div><div class="v">${line.strokes || '–'}</div><div class="l">Strokes</div></div>
      <div><div class="v">${line.thru ? fmtToPar(line.toPar) : '–'}</div><div class="l">To Par</div></div>
    </div>
    <div class="holes">
      <div class="nine-label">Front 9</div>
      ${front.map(holeCard).join('')}
      <div class="nine-label">Back 9</div>
      ${back.map(holeCard).join('')}
    </div>
  `;
  bindChips(rid => {
    currentRoundId = rid;
    localStorage.setItem('dd_round', rid);
    render();
  });
  $view.querySelectorAll('[data-hole]').forEach(b => {
    b.onclick = () => openHoleModal(Number(b.dataset.hole));
  });
}

function openHoleModal(hole) {
  modalHole = hole;
  modalStrokes = myScores(currentRoundId)[hole] ?? null;
  drawModal();
  $backdrop.hidden = false;
}

function closeModal() {
  $backdrop.hidden = true;
  modalHole = null;
  render();
  fetchState();
}

function drawModal() {
  const r = round(currentRoundId);
  const h = course(r).holes[modalHole - 1];
  const rel = modalStrokes != null ? modalStrokes - h.par : null;
  const relText = rel === null ? '' :
    rel <= -2 ? SCORE_NAMES.eagle : rel === -1 ? SCORE_NAMES.birdie :
    rel === 0 ? 'Par ✓' : rel === 1 ? 'Bogey' : `+${rel}`;
  const relClass = rel === null ? '' : rel < 0 ? 'under' : rel > 0 ? 'over' : 'level';

  $modal.innerHTML = `
    <div class="modal-head">
      <div>
        <h3>Hole ${h.hole}</h3>
        <div class="sub">Par ${h.par} · ${h.metres}m · Index ${h.index}</div>
      </div>
      <div class="hole-nav">
        <button id="prev-hole" ${h.hole === 1 ? 'disabled' : ''}>‹</button>
        <button id="next-hole" ${h.hole === 18 ? 'disabled' : ''}>›</button>
      </div>
    </div>
    <div class="stepper">
      <button id="dec">−</button>
      <div class="val ${modalStrokes == null ? 'empty' : ''}">${modalStrokes ?? 'tap +'}</div>
      <button id="inc">+</button>
    </div>
    <div class="rel-par topar ${relClass}">${relText}</div>
    <div class="quick">
      ${[h.par - 2, h.par - 1, h.par, h.par + 1, h.par + 2].filter(n => n >= 1)
        .map(n => `<button data-q="${n}" class="${modalStrokes === n ? 'sel' : ''}">${n}</button>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn secondary" id="clear-score" style="flex:1">Blank</button>
      <button class="btn" id="save-score" style="flex:2">Save${h.hole < 18 ? ' & next' : ''}</button>
    </div>
    <p class="hint" style="text-align:center;margin-top:10px" id="cancel-modal">Close</p>
  `;
  document.getElementById('inc').onclick = () => { modalStrokes = Math.min(20, (modalStrokes ?? h.par - 1) + 1); drawModal(); };
  document.getElementById('dec').onclick = () => { if (modalStrokes != null && modalStrokes > 1) { modalStrokes--; drawModal(); } };
  $modal.querySelectorAll('[data-q]').forEach(b => {
    b.onclick = () => { modalStrokes = Number(b.dataset.q); drawModal(); };
  });
  document.getElementById('prev-hole').onclick = () => saveThenGo(h.hole - 1);
  document.getElementById('next-hole').onclick = () => saveThenGo(h.hole + 1);
  document.getElementById('save-score').onclick = async () => {
    await saveScore();
    if (h.hole < 18) {
      modalHole = h.hole + 1;
      modalStrokes = myScores(currentRoundId)[modalHole] ?? null;
      drawModal();
    } else {
      closeModal();
      toast('Round card complete? Check the leaderboard 🏆');
    }
  };
  document.getElementById('clear-score').onclick = async () => {
    modalStrokes = null;
    await saveScore();
    closeModal();
  };
  document.getElementById('cancel-modal').onclick = closeModal;
}

async function saveThenGo(hole) {
  if (modalStrokes != null) await saveScore();
  modalHole = hole;
  modalStrokes = myScores(currentRoundId)[hole] ?? null;
  drawModal();
}

async function saveScore() {
  try {
    await post('/api/scores', {
      roundId: currentRoundId,
      playerId: me.id,
      hole: modalHole,
      strokes: modalStrokes
    });
    // keep local copy in sync so the modal flow feels instant
    if (!S.state.scores[currentRoundId]) S.state.scores[currentRoundId] = {};
    if (!S.state.scores[currentRoundId][me.id]) S.state.scores[currentRoundId][me.id] = {};
    if (modalStrokes == null) delete S.state.scores[currentRoundId][me.id][modalHole];
    else S.state.scores[currentRoundId][me.id][modalHole] = modalStrokes;
    toast(modalStrokes == null ? 'Hole cleared' : `Hole ${modalHole} saved: ${modalStrokes}`);
  } catch (e) {
    toast('Save failed — check signal');
  }
}

/* ---------------- leaderboard ---------------- */

function renderLeaderboard() {
  if (!lbRoundId) lbRoundId = currentRoundId;
  const isTrip = lbRoundId === 'trip';
  let body;
  if (isTrip) {
    body = tripTable();
  } else {
    const r = round(lbRoundId);
    body = roundTable(r);
  }
  $view.innerHTML = `
    ${roundChips(lbRoundId, null, [{ id: 'trip', label: '🏆 Whole Trip' }])}
    ${body}
    <p class="hint" style="text-align:center"><span class="live-dot"></span>Live — updates as scores come in</p>
  `;
  bindChips(rid => { lbRoundId = rid; render(); });
}

function roundTable(r) {
  const lines = roundLeaderboard(r);
  const c = course(r);
  if (!lines.length) {
    return `<div class="card"><h2>${esc(r.name)} · ${esc(c.name)}</h2>
      <p class="hint">No scores yet. First tee jitters? Get out there and post a number.</p></div>`;
  }
  let pos = 0, prevToPar = null, shown = 0;
  const rows = lines.map(l => {
    shown++;
    if (l.toPar !== prevToPar) { pos = shown; prevToPar = l.toPar; }
    return `<tr class="${pos === 1 ? 'first' : ''}">
      <td class="pos">${pos === 1 ? '🥇' : pos}</td>
      <td class="name">${esc(l.entity.name)}
        ${l.entity.isTeam ? `<div class="members">${esc(l.entity.members.join(', '))}</div>` : ''}
      </td>
      <td class="num">${l.thru}</td>
      <td class="num">${l.strokes}</td>
      <td class="num topar ${toParClass(l.toPar)}">${fmtToPar(l.toPar)}</td>
    </tr>`;
  }).join('');
  return `<div class="card">
    <h2>${esc(r.name)} · ${esc(c.name)} ${r.mode === 'ambrose' ? '· Ambrose teams' : ''}</h2>
    <table class="lb-table">
      <thead><tr><th></th><th>${r.mode === 'ambrose' && r.teams.length ? 'Team' : 'Player'}</th><th style="text-align:right">Thru</th><th style="text-align:right">Strokes</th><th style="text-align:right">Score</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/* Trip standings: each player gets their own toPar in stroke rounds,
   and their team's toPar in ambrose rounds. */
function tripTable() {
  const players = S.state.players;
  const perPlayer = players.map(p => {
    const parts = [];
    let total = 0, any = false;
    for (const r of S.state.rounds) {
      let line = null;
      if (r.mode === 'ambrose' && (r.teams || []).length) {
        const team = r.teams.find(t => t.playerIds.includes(p.id));
        if (team) {
          const l = computeLine(r, { playerIds: team.playerIds });
          if (l.thru > 0) line = l;
        }
      } else {
        const l = computeLine(r, { playerIds: [p.id] });
        if (l.thru > 0) line = l;
      }
      parts.push(line ? line.toPar : null);
      if (line) { total += line.toPar; any = true; }
    }
    return { p, parts, total, any };
  }).filter(x => x.any).sort((a, b) => a.total - b.total);

  if (!perPlayer.length) {
    return `<div class="card"><h2>Whole trip</h2><p class="hint">Standings appear once scores are in.</p></div>`;
  }
  let pos = 0, prev = null, shown = 0;
  const rows = perPlayer.map(x => {
    shown++;
    if (x.total !== prev) { pos = shown; prev = x.total; }
    return `<tr class="${pos === 1 ? 'first' : ''}">
      <td class="pos">${pos === 1 ? '🥇' : pos}</td>
      <td class="name">${esc(x.p.name)}</td>
      ${x.parts.map(pt => `<td class="num topar ${pt === null ? '' : toParClass(pt)}">${pt === null ? '–' : fmtToPar(pt)}</td>`).join('')}
      <td class="num topar ${toParClass(x.total)}"><strong>${fmtToPar(x.total)}</strong></td>
    </tr>`;
  }).join('');
  return `<div class="card">
    <h2>Whole trip — combined to par</h2>
    <table class="lb-table">
      <thead><tr><th></th><th>Player</th>${S.state.rounds.map(r => `<th style="text-align:right">${esc(course(r).name.split(' ')[0])}</th>`).join('')}<th style="text-align:right">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint" style="margin-top:8px">Ambrose rounds count each player's team score.</p>
  </div>`;
}

/* ---------------- stats / analytics ---------------- */

function renderStats() {
  if (!statsRoundId) statsRoundId = currentRoundId;
  const r = round(statsRoundId);
  const c = course(r);
  const lines = roundLeaderboard(r);
  const holes = c.holes;

  let html = roundChips(statsRoundId);

  if (!lines.length) {
    html += `<div class="card"><h2>${esc(r.name)} · ${esc(c.name)}</h2>
      <p class="hint">Stats appear once scores are in for this round.</p></div>`;
    $view.innerHTML = html;
    bindChips(rid => { statsRoundId = rid; render(); });
    return;
  }

  /* Mystery prize hole — hidden from players until the round is done */
  if (r.mysteryHole) {
    const h = holes[r.mysteryHole - 1];
    const entries = lines
      .map(l => ({ name: l.entity.name, s: l.perHole[r.mysteryHole] }))
      .filter(e => e.s != null)
      .sort((a, b) => a.s - b.s);
    const best = entries.length ? entries.filter(e => e.s === entries[0].s) : [];
    html += `<div class="card mystery">
      <div class="prize">🎁</div>
      <h2 style="text-align:center">Mystery prize · Hole ${h.hole} (par ${h.par})</h2>
      ${best.length
        ? `<div class="winner">${esc(best.map(b => b.name).join(' & '))}</div>
           <div class="sub">${best[0].s} strokes (${fmtToPar(best[0].s - h.par)}) ${best.length > 1 ? '— tied, split the prize!' : '— take a bow'}</div>`
        : `<div class="sub">Nobody has played hole ${h.hole} yet…</div>`}
      ${!r.mysteryVisible ? `<div class="sub" style="margin-top:6px">🤫 Only you can see this — players see it once the round is done</div>` : ''}
    </div>`;
  } else if (r.mysteryHoleSet) {
    html += `<div class="card mystery">
      <div class="prize">🔒</div>
      <h2 style="text-align:center">Mystery prize hole</h2>
      <div class="sub">One of these 18 holes is worth a prize… revealed when everyone's finished the round. Play them all like it's this one.</div>
    </div>`;
  } else {
    html += `<div class="card mystery">
      <div class="prize">🎁</div>
      <h2 style="text-align:center">Mystery prize hole</h2>
      <div class="sub">${amAdmin() ? 'Not set for this round — pick one in Setup ⚙️' : 'Not set for this round (yet…)'}</div>
    </div>`;
  }

  /* Scoring breakdown stacked bars */
  const buckets = l => {
    const b = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
    for (const [hole, s] of Object.entries(l.perHole)) {
      b[scoreClass(s, holes[hole - 1].par)]++;
    }
    return b;
  };
  html += `<div class="card"><h2>Scoring breakdown</h2>
    ${lines.map(l => {
      const b = buckets(l);
      const total = l.thru || 1;
      const seg = (k) => b[k] ? `<span class="b-${k}" style="width:${(b[k] / total * 100).toFixed(1)}%"></span>` : '';
      return `<div class="bar-row">
        <div class="lbl"><span>${esc(l.entity.name)}</span><span>${l.thru} holes</span></div>
        <div class="bar">${seg('eagle')}${seg('birdie')}${seg('par')}${seg('bogey')}${seg('double')}</div>
      </div>`;
    }).join('')}
    <div class="legend">
      <span><i style="background:var(--gold)"></i>Eagle+</span>
      <span><i style="background:#d92d20"></i>Birdie</span>
      <span><i style="background:var(--fairway)"></i>Par</span>
      <span><i style="background:#8fb6ec"></i>Bogey</span>
      <span><i style="background:var(--over)"></i>Double+</span>
    </div>
  </div>`;

  /* Hole difficulty */
  const holeAvg = holes.map(h => {
    const ss = lines.map(l => l.perHole[h.hole]).filter(s => s != null);
    if (!ss.length) return null;
    return { h, avg: ss.reduce((a, b) => a + b, 0) / ss.length - h.par, n: ss.length };
  }).filter(Boolean);
  if (holeAvg.length) {
    const hardest = [...holeAvg].sort((a, b) => b.avg - a.avg).slice(0, 3);
    const easiest = [...holeAvg].sort((a, b) => a.avg - b.avg).slice(0, 3);
    const fmt = x => `<div class="stat-row">
      <div><div class="who">Hole ${x.h.hole} · par ${x.h.par}</div><div class="what">${x.h.metres}m · index ${x.h.index}</div></div>
      <div class="big-val topar ${toParClass(Math.sign(x.avg))}">${x.avg >= 0 ? '+' : ''}${x.avg.toFixed(2)}</div>
    </div>`;
    html += `<div class="card"><h2>💀 Card wreckers (avg vs par)</h2>${hardest.map(fmt).join('')}</div>`;
    html += `<div class="card"><h2>🍰 Birdie buffet</h2>${easiest.map(fmt).join('')}</div>`;
  }

  /* Highlights */
  const highlights = [];
  // best single hole
  let bestHole = null;
  for (const l of lines) {
    for (const [hole, s] of Object.entries(l.perHole)) {
      const d = s - holes[hole - 1].par;
      if (!bestHole || d < bestHole.d) bestHole = { name: l.entity.name, hole: Number(hole), s, d };
    }
  }
  if (bestHole && bestHole.d < 0) {
    highlights.push({ icon: '⭐', who: bestHole.name, what: `${SCORE_NAMES[scoreClass(bestHole.s, bestHole.s - bestHole.d)]} on hole ${bestHole.hole}`, val: `${bestHole.s} (${fmtToPar(bestHole.d)})` });
  }
  // longest par-or-better streak
  let bestStreak = null;
  for (const l of lines) {
    let cur = 0, best = 0;
    for (const h of holes) {
      const s = l.perHole[h.hole];
      if (s != null && s <= h.par) { cur++; best = Math.max(best, cur); }
      else cur = 0;
    }
    if (best >= 2 && (!bestStreak || best > bestStreak.n)) bestStreak = { name: l.entity.name, n: best };
  }
  if (bestStreak) highlights.push({ icon: '🔥', who: bestStreak.name, what: 'Longest par-or-better streak', val: `${bestStreak.n} holes` });
  // biggest blow-up
  let blowUp = null;
  for (const l of lines) {
    for (const [hole, s] of Object.entries(l.perHole)) {
      const d = s - holes[hole - 1].par;
      if (!blowUp || d > blowUp.d) blowUp = { name: l.entity.name, hole: Number(hole), s, d };
    }
  }
  if (blowUp && blowUp.d >= 2) {
    highlights.push({ icon: '🫠', who: blowUp.name, what: `Blow-up on hole ${blowUp.hole}`, val: `${blowUp.s} (${fmtToPar(blowUp.d)})` });
  }
  // most consistent (lowest stddev vs par, min 6 holes)
  let steady = null;
  for (const l of lines) {
    if (l.thru < 6) continue;
    const diffs = Object.entries(l.perHole).map(([hole, s]) => s - holes[hole - 1].par);
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const sd = Math.sqrt(diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / diffs.length);
    if (!steady || sd < steady.sd) steady = { name: l.entity.name, sd };
  }
  if (steady) highlights.push({ icon: '🧊', who: steady.name, what: 'Ice in the veins (most consistent)', val: `±${steady.sd.toFixed(2)}` });
  // front vs back
  for (const l of lines) {
    const nine = idx => {
      const hs = holes.slice(idx, idx + 9);
      const played = hs.filter(h => l.perHole[h.hole] != null);
      if (played.length < 3) return null;
      return played.reduce((a, h) => a + l.perHole[h.hole] - h.par, 0) / played.length;
    };
    const f = nine(0), b = nine(9);
    if (f != null && b != null && Math.abs(f - b) >= 0.8) {
      highlights.push({
        icon: b < f ? '📈' : '📉',
        who: l.entity.name,
        what: b < f ? 'Back-nine surge' : 'Faded on the back nine',
        val: `${f >= 0 ? '+' : ''}${f.toFixed(1)} → ${b >= 0 ? '+' : ''}${b.toFixed(1)}/hole`
      });
    }
  }

  if (highlights.length) {
    html += `<div class="card"><h2>✨ Highlights</h2>
      ${highlights.map(h => `<div class="stat-row">
        <div><div class="who">${h.icon} ${esc(h.who)}</div><div class="what">${esc(h.what)}</div></div>
        <div class="big-val">${esc(h.val)}</div>
      </div>`).join('')}
    </div>`;
  }

  $view.innerHTML = html;
  bindChips(rid => { statsRoundId = rid; render(); });
}

/* ---------------- setup ---------------- */

function renderSetup() {
  setupDirty = false;
  if (!amAdmin()) {
    $view.innerHTML = `<div class="card"><h2>Setup</h2>
      <p class="hint">Only the trip organiser can change the setup.</p></div>`;
    return;
  }
  const players = S.state.players;
  $view.innerHTML = `
    ${S.state.rounds.map(r => setupRoundCard(r)).join('')}
    <div class="card">
      <h2>Players (${players.length})</h2>
      <div class="player-pick">
        ${players.map(p => `<button class="chip" data-del-player="${p.id}">${esc(p.name)} ✕</button>`).join('') || '<p class="hint">Nobody has joined yet.</p>'}
      </div>
      <p class="hint" style="margin-top:10px">Tap a player to remove them (and their scores).</p>
    </div>
    <div class="card">
      <h2>Data</h2>
      <a class="btn secondary" href="/api/export?pid=${me.id}" style="text-decoration:none">Download backup (JSON)</a>
    </div>
  `;

  S.state.rounds.forEach(r => bindSetupRound(r));

  $view.querySelectorAll('[data-del-player]').forEach(b => {
    b.onclick = async () => {
      const p = players.find(p => p.id === b.dataset.delPlayer);
      if (!confirm(`Remove ${p.name} and all their scores?`)) return;
      await api('/api/players/' + p.id, { method: 'DELETE' });
      if (me && me.id === p.id) { me = null; localStorage.removeItem('dd_me'); }
      await fetchState();
      render();
    };
  });
}

function setupRoundCard(r) {
  const c = course(r);
  const players = S.state.players;
  const assigned = new Set((r.teams || []).flatMap(t => t.playerIds));
  return `<div class="card" data-setup-round="${r.id}">
    <h2>${esc(r.name)} · ${esc(c.name)}</h2>
    <div class="field">
      <label>Format</label>
      <div class="seg">
        <button data-mode="stroke" class="${r.mode === 'stroke' ? 'active' : ''}">Stroke play</button>
        <button data-mode="ambrose" class="${r.mode === 'ambrose' ? 'active' : ''}">Ambrose (teams)</button>
      </div>
    </div>
    <div class="field">
      <label>Mystery prize hole 🎁</label>
      <div class="row-inline">
        <select data-mystery>
          <option value="">— none —</option>
          ${c.holes.map(h => `<option value="${h.hole}" ${r.mysteryHole === h.hole ? 'selected' : ''}>Hole ${h.hole} (par ${h.par})</option>`).join('')}
        </select>
        <button class="btn secondary small" data-random-mystery>🎲</button>
      </div>
      ${r.mysteryHoleSet ? `
      <p class="hint" style="margin-top:8px">
        ${r.mysteryVisible
          ? 'Currently visible to all players.'
          : 'Hidden from players until everyone finishes the round — or reveal it early:'}
      </p>
      <button class="btn secondary small" data-toggle-reveal style="margin-top:6px">
        ${r.mysteryVisible ? 'Hide again 🤫' : 'Reveal now 📣'}
      </button>` : ''}
    </div>
    ${r.mode === 'ambrose' ? `
    <div class="field">
      <label>Teams</label>
      ${(r.teams || []).map((t, i) => `
        <div class="team-box" data-team="${t.id}">
          <div class="team-head">
            <input value="${esc(t.name)}" data-team-name placeholder="Team name">
            <button class="btn danger small" data-del-team>✕</button>
          </div>
          <div class="member-toggle">
            ${players.map(p => {
              const inTeam = t.playerIds.includes(p.id);
              const elsewhere = !inTeam && assigned.has(p.id);
              return `<button class="chip ${inTeam ? 'active' : ''} ${elsewhere ? 'taken' : ''}" data-member="${p.id}">${esc(p.name)}</button>`;
            }).join('')}
          </div>
        </div>`).join('')}
      <button class="btn secondary" data-add-team>+ Add team</button>
    </div>` : ''}
    <button class="btn" data-save-round>Save ${esc(r.name)}</button>
    <button class="btn danger" data-clear-scores style="margin-top:8px">Clear all ${esc(r.name)} scores</button>
  </div>`;
}

function bindSetupRound(r) {
  const box = $view.querySelector(`[data-setup-round="${r.id}"]`);
  if (!box) return;
  const markDirty = () => { setupDirty = true; };

  // local working copy of teams
  let teams = JSON.parse(JSON.stringify(r.teams || []));
  let mode = r.mode;

  box.querySelectorAll('[data-mode]').forEach(b => {
    b.onclick = async () => {
      mode = b.dataset.mode;
      await post('/api/rounds/' + r.id, { mode });
      await fetchState();
      render();
    };
  });
  box.querySelector('[data-mystery]').onchange = markDirty;
  const revealBtn = box.querySelector('[data-toggle-reveal]');
  if (revealBtn) {
    revealBtn.onclick = async () => {
      await post('/api/rounds/' + r.id, { mysteryRevealed: !r.mysteryRevealed });
      setupDirty = false;
      await fetchState();
      render();
      toast(r.mysteryRevealed ? 'Mystery hole hidden again' : 'Mystery hole revealed to everyone 📣');
    };
  }
  box.querySelector('[data-random-mystery]').onclick = () => {
    const sel = box.querySelector('[data-mystery]');
    sel.value = String(1 + Math.floor(Math.random() * 18));
    markDirty();
    toast(`Mystery hole rolled: ${sel.value} — hit save!`);
  };

  const readTeams = () => {
    const out = [];
    box.querySelectorAll('[data-team]').forEach(tb => {
      const id = tb.dataset.team;
      const t = teams.find(t => t.id === id);
      out.push({
        id,
        name: tb.querySelector('[data-team-name]').value || 'Team',
        playerIds: t ? t.playerIds : []
      });
    });
    return out;
  };

  box.querySelectorAll('[data-team]').forEach(tb => {
    const teamId = tb.dataset.team;
    const team = teams.find(t => t.id === teamId);
    tb.querySelector('[data-team-name]').oninput = markDirty;
    tb.querySelector('[data-del-team]').onclick = () => {
      teams = teams.filter(t => t.id !== teamId);
      tb.remove();
      markDirty();
    };
    tb.querySelectorAll('[data-member]').forEach(mb => {
      mb.onclick = () => {
        const pid = mb.dataset.member;
        // remove from any other team, toggle here
        for (const t of teams) {
          if (t.id !== teamId) t.playerIds = t.playerIds.filter(x => x !== pid);
        }
        if (team.playerIds.includes(pid)) {
          team.playerIds = team.playerIds.filter(x => x !== pid);
          mb.classList.remove('active');
        } else {
          team.playerIds.push(pid);
          mb.classList.add('active');
          mb.classList.remove('taken');
        }
        markDirty();
      };
    });
  });

  const addTeamBtn = box.querySelector('[data-add-team]');
  if (addTeamBtn) {
    addTeamBtn.onclick = async () => {
      teams = readTeams();
      teams.push({ name: `Team ${teams.length + 1}`, playerIds: [] });
      await post('/api/rounds/' + r.id, { teams });
      await fetchState();
      render();
    };
  }

  box.querySelector('[data-save-round]').onclick = async () => {
    const mysteryVal = box.querySelector('[data-mystery]').value;
    const body = { mysteryHole: mysteryVal ? Number(mysteryVal) : null };
    if (mode === 'ambrose') body.teams = readTeams();
    await post('/api/rounds/' + r.id, body);
    setupDirty = false;
    await fetchState();
    render();
    toast(`${r.name} saved ✓`);
  };

  box.querySelector('[data-clear-scores]').onclick = async () => {
    if (!confirm(`Really clear ALL scores for ${r.name}? This can't be undone.`)) return;
    await post(`/api/rounds/${r.id}/clear-scores`, {});
    await fetchState();
    render();
    toast(`${r.name} scores cleared`);
  };
}

/* ---------------- boot ---------------- */

$nav.querySelectorAll('button').forEach(b => {
  b.onclick = () => setView(b.dataset.view);
});
$whoami.onclick = () => {
  if (confirm('Switch player? Your scores stay saved.')) {
    me = null;
    localStorage.removeItem('dd_me');
    setView('join');
  }
};
$backdrop.addEventListener('click', e => {
  if (e.target === $backdrop) closeModal();
});

fetchState().then(() => {
  // if we thought we were someone who no longer exists, re-join
  if (me && !S.state.players.some(p => p.id === me.id)) {
    me = null;
    localStorage.removeItem('dd_me');
    currentView = 'join';
  }
  render();
});
setInterval(fetchState, 4000);
