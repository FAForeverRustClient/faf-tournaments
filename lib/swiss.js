// NOTE: not yet `// @ts-check` (same reason as lib/match.js: untyped dynamic
// tournament objects). Behaviour verified by the runtime test suite.
// Swiss format: standings, round pairing, byes, completion, and the after-report
// progression hook. Imports the shared match primitives (newMatch, initMatchVetoes) from
// lib/match.js. lib/match.js calls swissAfterReport back via its injected hook, so
// there is no circular import (swiss -> match only).
//
// Two OPTIONAL layers sit on top of the classic round-count Swiss. Both are off unless
// explicitly configured, and when they are off every function here behaves exactly as it
// did before they existed:
//
//   1. RECORD CUTS (cfg.winCut / cfg.lossCut). A team leaves the stage the moment it
//      reaches either threshold instead of playing a fixed number of rounds - the format
//      used by CS/Valorant majors and by the FAF Invitational ("3 wins advance, 3 losses
//      eliminated"). cfg.rounds becomes a safety cap rather than the terminator.
//      cfg.decidingBo, if set, lengthens exactly those matches where a win qualifies
//      someone or a loss eliminates them.
//   2. STAGE 2 (t.stage2). Instead of crowning the top of the standings, the top N are
//      cut into a playoff bracket inside the SAME tournament. See stageTwoBuild below.
'use strict';

const { newMatch, initMatchVetoes, buildSingle, buildDouble } = require('./match');

// Injected by the host, same idiom as lib/match.js. openStagePicks(t, field) may take over the
// stage-2 build to run an opponent pick phase first; it returns true when it did.
const hooks = { openStagePicks: null };
function setSwissHooks(h) { Object.assign(hooks, h); }

// ---------- optional record cuts ----------

// Normalised view of the cut config. `on` is false for every tournament that does not
// explicitly set a cut, which is the gate every new code path below tests.
function swissCuts(t) {
  const c = (t && t.cfg) || {};
  const w = parseInt(c.winCut, 10);
  const l = parseInt(c.lossCut, 10);
  const win = (w > 0) ? w : 0;
  const loss = (l > 0) ? l : 0;
  return { on: !!(win || loss), win, loss };
}

// The most rounds any single team can play under a set of cuts: it takes (win-1) wins and
// (loss-1) losses to still be alive, and the next game decides it. Used to derive a sane
// safety cap so "Round r / N" still reads correctly in the UI.
function swissCutRounds(win, loss) {
  const w = (win > 0) ? win : 0;
  const l = (loss > 0) ? loss : 0;
  if (!w && !l) return 0;
  if (!w) return l;
  if (!l) return w;
  return w + l - 1;
}

// ONE walk of the matches, shared by standings, progress and pairing, so those three can
// never disagree about a team's record. `state` is the only new concept:
//   'active'     - still playing
//   'advanced'   - hit the win cut (cuts only)
//   'eliminated' - hit the loss cut (cuts only)
//   'done'       - played its full round quota (no cuts)
function swissRecord(t) {
  const cuts = swissCuts(t);
  const rec = {};
  for (const team of t.teams) {
    rec[team.id] = { teamId: team.id, seed: team.seed, wins: 0, losses: 0, gd: 0, byes: 0, played: 0, pending: false, state: 'active' };
  }
  for (const m of t.matches) {
    if (m.bracket !== 'sw') continue;
    if (m.status === 'bye') {
      const id = m.team1 !== 'BYE' ? m.team1 : m.team2;
      if (rec[id]) { rec[id].wins++; rec[id].byes++; rec[id].gd += 1; rec[id].played++; }
    } else if (m.status === 'done') {
      const w = rec[m.winner], l = rec[m.loser];
      const ws = m.winner === m.team1 ? m.score1 : m.score2;
      const ls = m.winner === m.team1 ? m.score2 : m.score1;
      if (w) { w.wins++; w.gd += ws - ls; w.played++; }
      if (l) { l.losses++; l.gd -= ws - ls; l.played++; }
    } else {
      if (rec[m.team1]) rec[m.team1].pending = true;
      if (rec[m.team2]) rec[m.team2].pending = true;
    }
  }
  const quota = (t.cfg && t.cfg.rounds) || 0;
  for (const id of Object.keys(rec)) {
    const r = rec[id];
    if (cuts.on) {
      if (cuts.win && r.wins >= cuts.win) r.state = 'advanced';
      else if (cuts.loss && r.losses >= cuts.loss) r.state = 'eliminated';
      else if (quota && r.played >= quota) r.state = 'done';   // safety cap
    } else if (quota && r.played >= quota) {
      r.state = 'done';
    }
  }
  return rec;
}

// Teams still to be decided. Only meaningful with cuts on.
function swissActive(t, rec) {
  const r = rec || swissRecord(t);
  return t.teams.filter(x => r[x.id] && r[x.id].state === 'active').map(x => x.id);
}

// Everyone who cleared the win cut, best record first. This is the qualified field.
function swissAdvanced(t) {
  const rec = swissRecord(t);
  return swissSort(Object.values(rec).filter(r => r.state === 'advanced')).map(r => r.teamId);
}

function swissSort(rows) {
  return rows.slice().sort((a, b) => b.wins - a.wins || b.gd - a.gd || a.seed - b.seed);
}

function swissStandings(t) {
  return swissSort(Object.values(swissRecord(t)));
}

// A match is "deciding" when a win qualifies someone or a loss knocks them out. Those are the
// matches LotS plays longer. Returns the tournament Bo unless cuts AND a decidingBo are set.
function swissBoFor(t, rec, aId, bId) {
  const cfg = t.cfg || {};
  const cuts = swissCuts(t);
  const dec = parseInt(cfg.decidingBo, 10);
  if (!cuts.on || !(dec > 0)) return cfg.bo;
  const onTheLine = id => {
    const r = rec[id];
    if (!r) return false;
    if (cuts.win && r.wins === cuts.win - 1) return true;    // a win qualifies them
    if (cuts.loss && r.losses === cuts.loss - 1) return true; // a loss eliminates them
    return false;
  };
  return (onTheLine(aId) || onTheLine(bId)) ? dec : cfg.bo;
}

// Perfect matching inside one score group, avoiding pairs that have already met.
// Exhaustive with backtracking, because a greedy walk corners itself: in a 1-1 group every
// player has exactly one forbidden partner, and picking wrong early forces a rematch at the
// end. Score groups never exceed half the field (8 in a 16-player stage), so this is instant.
function matchGroup(ids, forbidden) {
  const n = ids.length;
  if (n % 2 === 1) return null;
  if (!n) return [];
  // Iterative deepening on the number of repeats allowed: zero first, and only if the group
  // genuinely has no rematch-free pairing does it accept one, then two, and so on. A small
  // field eventually runs out of fresh opponents (an 8-player 3/3 stage does), and drawing a
  // round with one repeat beats refusing to draw it at all.
  for (let allow = 0; allow <= n; allow++) {
    const used = new Array(n).fill(false);
    const out = [];
    const walk = (count, spent) => {
      if (count === n) return true;
      let i = 0;
      while (i < n && used[i]) i++;
      if (i >= n) return true;
      used[i] = true;
      for (let j = i + 1; j < n; j++) {
        if (used[j]) continue;
        const cost = forbidden[ids[i] + '|' + ids[j]] ? 1 : 0;
        if (spent + cost > allow) continue;
        used[j] = true;
        out.push([ids[i], ids[j]]);
        if (walk(count + 2, spent + cost)) return true;
        out.pop();
        used[j] = false;
      }
      used[i] = false;
      return false;
    };
    if (walk(0, 0)) return out;
  }
  return null;
}

// Draw one round of a record-cut Swiss: split the active field into score groups, float the
// odd player down a group (standard Swiss practice), and find a rematch-free pairing inside
// each group.
function pairRoundByRecord(t, r, rec, standings, played) {
  const active = standings.filter(s => rec[s.teamId].state === 'active').map(s => s.teamId);
  if (!active.length) return;
  const groups = [];
  for (const id of active) {
    const k = rec[id].wins + '-' + rec[id].losses;
    let g = groups[groups.length - 1];
    if (!g || g.k !== k) { g = { k, ids: [] }; groups.push(g); }
    g.ids.push(id);
  }
  // An odd group sends its lowest-ranked player down to the next one. That can make the next
  // group odd in turn, which is correct - the imbalance cascades to the bottom of the table.
  for (let i = 0; i < groups.length - 1; i++) {
    if (groups[i].ids.length % 2 === 1) groups[i + 1].ids.unshift(groups[i].ids.pop());
  }
  const last = groups[groups.length - 1];
  if (last.ids.length % 2 === 1) {
    // Bye: lowest-ranked player who has not had one yet. Under cuts a bye is a free win, so
    // it goes to whoever has had the least luck so far, and never twice to the same team.
    let pick = -1;
    for (let i = last.ids.length - 1; i >= 0; i--) { if (!rec[last.ids[i]].byes) { pick = i; break; } }
    if (pick < 0) pick = last.ids.length - 1;
    const byeTeam = last.ids.splice(pick, 1)[0];
    const bm = newMatch(t, 'sw', r, 99, t.cfg.bo);
    bm.team1 = byeTeam; bm.team2 = 'BYE'; bm.status = 'bye'; bm.winner = byeTeam; bm.loser = 'BYE';
    if (!last.ids.length) groups.pop();
  }
  let idx = 0;
  for (const g of groups) {
    const pairs = matchGroup(g.ids, played) || [];
    for (const [a, b] of pairs) {
      const m = newMatch(t, 'sw', r, idx++, swissBoFor(t, rec, a, b));
      m.team1 = a; m.team2 = b; m.status = 'ready';
      initMatchVetoes(t, m);
    }
  }
}

function swissPairRound(t, r) {
  const cuts = swissCuts(t);
  const rec = swissRecord(t);
  const standings = swissSort(Object.values(rec));
  const played = {};
  for (const m of t.matches) {
    if (m.bracket === 'sw' && m.team1 && m.team2 && m.team1 !== 'BYE' && m.team2 !== 'BYE') {
      played[m.team1 + '|' + m.team2] = 1;
      played[m.team2 + '|' + m.team1] = 1;
    }
  }
  if (cuts.on) return pairRoundByRecord(t, r, rec, standings, played);
  const pool = standings.map(s => s.teamId);
  if (pool.length % 2 === 1) {
    let byeIdx = pool.length - 1;
    for (let i = pool.length - 1; i >= 0; i--) {
      const st = standings.find(s => s.teamId === pool[i]);
      if (st && st.byes === 0) { byeIdx = i; break; }
    }
    const byeTeam = pool.splice(byeIdx, 1)[0];
    const bm = newMatch(t, 'sw', r, 99, t.cfg.bo);
    bm.team1 = byeTeam; bm.team2 = 'BYE'; bm.status = 'bye'; bm.winner = byeTeam; bm.loser = 'BYE';
  }
  let idx = 0;
  while (pool.length) {
    const a = pool.shift();
    let j = 0;
    while (j < pool.length - 1 && played[a + '|' + pool[j]]) j++;
    const b = pool.splice(j, 1)[0];
    const m = newMatch(t, 'sw', r, idx++, swissBoFor(t, rec, a, b));
    m.team1 = a; m.team2 = b; m.status = 'ready';
    initMatchVetoes(t, m);
  }
}

function swissMaxRound(t) {
  let r = 0;
  for (const m of t.matches) if (m.bracket === 'sw' && m.round > r) r = m.round;
  return r;
}

// Kept as-is for callers that only care about played/pending. Derived from the same walk
// as standings so the two can never drift.
function swissProgress(t) {
  const rec = swissRecord(t);
  const st = {};
  for (const team of t.teams) st[team.id] = { played: rec[team.id].played, pending: rec[team.id].pending };
  return st;
}

function swissGiveBye(t, teamId, round) {
  const bm = newMatch(t, 'sw', round, 99, t.cfg.bo);
  bm.team1 = teamId; bm.team2 = 'BYE'; bm.status = 'bye'; bm.winner = teamId; bm.loser = 'BYE';
}

// ---------- stage 2 ----------
// t.stage2 = { type:'single'|'double', cutTo:N, rounds:[bo...]|wb/lb/gf, lbHandicap, built }
// The playoff bracket is built from the qualified field only, using a separate seed field so
// the Swiss seeds (which came from rating) are left untouched and still readable.

function stageTwoCfg(t) {
  const s = t && t.stage2;
  if (!s || !s.cutTo) return null;
  return s;
}

// Who goes through. With cuts on that is everyone who cleared the win cut, in standings
// order; without cuts it is simply the top N of the standings.
function stageTwoField(t) {
  const s = stageTwoCfg(t);
  if (!s) return [];
  const cuts = swissCuts(t);
  const n = Math.max(2, parseInt(s.cutTo, 10) || 0);
  if (cuts.on && cuts.win) {
    const adv = swissAdvanced(t);
    if (adv.length >= n) return adv.slice(0, n);
    // Short field (forfeits): top up from the standings so the bracket can still be built.
    const rest = swissStandings(t).map(r => r.teamId).filter(id => adv.indexOf(id) < 0);
    return adv.concat(rest).slice(0, n);
  }
  return swissStandings(t).map(r => r.teamId).slice(0, n);
}

function stageTwoBuild(t, slots) {
  const s = stageTwoCfg(t);
  if (!s || s.built) return false;
  const field = stageTwoField(t);
  if (field.length < 2) return false;
  field.forEach((id, i) => {
    const tm = t.teams.find(x => x.id === id);
    if (tm) tm.stage2Seed = i + 1;
  });
  const opts = { only: field, seedKey: 'stage2Seed' };
  if (Array.isArray(slots) && slots.length) opts.slots = slots;
  if (s.type === 'double') {
    buildDouble(t, {
      wb: s.wb, lb: s.lb, gf: s.gf, lbHandicap: s.lbHandicap ? 1 : 0
    }, 0, opts);
  } else {
    buildSingle(t, { rounds: s.rounds }, 0, opts);
  }
  s.built = Date.now();
  s.field = field.slice();
  return true;
}

// ---------- completion ----------

function swissStageDone(t) {
  const cuts = swissCuts(t);
  const rec = swissRecord(t);
  if (cuts.on) {
    // decided when nobody is still active and nothing is outstanding
    for (const team of t.teams) {
      const r = rec[team.id];
      if (r.state === 'active') return false;
      if (r.pending) return false;
    }
    return true;
  }
  return !t.teams.some(x => rec[x.id].played < t.cfg.rounds);
}

function swissFinishIfDone(t) {
  if (!swissStageDone(t)) return false;
  const s2 = stageTwoCfg(t);
  if (s2) {
    // When the playoff field picks its own matchups, the host opens that phase first and calls
    // stageTwoBuild itself once every pick is in. hooks.openStagePicks returns true if it took
    // over; nothing here knows how the pick phase works, only that it may exist.
    if (s2.pickPhase && !s2.built && hooks.openStagePicks && hooks.openStagePicks(t, stageTwoField(t))) return true;
    stageTwoBuild(t);        // no-op once built; the bracket crowns the champion from here
    return true;
  }
  const gfExisting = t.matches.find(m => m.bracket === 'gf');
  if (t.cfg.final) {
    if (!gfExisting) {
      const top = swissStandings(t);
      const gf = newMatch(t, 'gf', 1, 0, t.cfg.finalBo);
      gf.team1 = top[0].teamId; gf.team2 = top[1].teamId; gf.status = 'ready';
    }
  } else if (!t.championTeamId) {
    const top = swissStandings(t);
    t.championTeamId = top[0].teamId;
    t.status = 'finished';
  }
  return true;
}

function swissAfterReport(t) {
  if (swissFinishIfDone(t)) return;
  const cuts = swissCuts(t);

  if (cuts.on) {
    // Record cuts pair a whole round at a time. Everyone still active plays in every round,
    // so the score groups stay aligned and the draw can always stay inside a group. Eager
    // pairing cannot do that: it would pair whichever two players happened to finish first,
    // which in practice means re-pairing the two who just played each other.
    const maxR = swissMaxRound(t);
    const open = t.matches.some(m => m.bracket === 'sw' && m.round === maxR &&
      (m.status === 'ready' || m.status === 'live' || m.status === 'waiting'));
    if (open) return;
    const rec = swissRecord(t);
    const active = t.teams.filter(x => rec[x.id].state === 'active');
    if (active.length && maxR < t.cfg.rounds) swissPairRound(t, maxR + 1);
    swissFinishIfDone(t);
    return;
  }

  if (t.cfg.fast) {
    // eager pairing: match up free teams as soon as possible
    for (let guard = 0; guard < 200; guard++) {
      const rec = swissRecord(t);
      const standingsOrder = swissSort(Object.values(rec)).map(x => x.teamId);
      const pos = {};
      standingsOrder.forEach((id, i) => { pos[id] = i; });
      const pool = t.teams
        .filter(x => rec[x.id].played < t.cfg.rounds && !rec[x.id].pending)
        .map(x => x.id)
        .sort((a, b) => (rec[a].played - rec[b].played) || (pos[a] - pos[b]));
      if (pool.length >= 2) {
        const playedPairs = {};
        for (const m of t.matches) {
          if (m.bracket === 'sw' && m.team1 && m.team2 && m.team1 !== 'BYE' && m.team2 !== 'BYE') {
            playedPairs[m.team1 + '|' + m.team2] = 1;
            playedPairs[m.team2 + '|' + m.team1] = 1;
          }
        }
        const a = pool[0];
        const sameGroup = x => rec[x].played === rec[a].played;
        // prefer same group + no rematch, then same group, then no rematch, then anyone
        let b = pool.slice(1).find(x => sameGroup(x) && !playedPairs[a + '|' + x]);
        if (!b) b = pool.slice(1).find(x => sameGroup(x));
        if (!b) b = pool.slice(1).find(x => !playedPairs[a + '|' + x]);
        if (!b) b = pool[1];
        const m = newMatch(t, 'sw', Math.min(rec[a].played, rec[b].played) + 1, 98, swissBoFor(t, rec, a, b));
        m.team1 = a; m.team2 = b; m.status = 'ready';
        initMatchVetoes(t, m);
        continue; // try to pair more
      }
      if (pool.length === 1) {
        const lonely = pool[0];
        const othersPending = t.teams.some(x => x.id !== lonely &&
          rec[x.id].played < t.cfg.rounds && rec[x.id].pending);
        if (!othersPending) {
          // A bye is a free win. Under cuts that can carry a team over the win cut, so it is
          // only ever handed out when literally nobody else is available to play them.
          swissGiveBye(t, lonely, rec[lonely].played + 1);
          if (swissFinishIfDone(t)) return;
          continue;
        }
      }
      break;
    }
    swissFinishIfDone(t);
    return;
  }

  // classic: next round only when the current one is fully done
  const maxR = swissMaxRound(t);
  const open = t.matches.some(m => m.bracket === 'sw' && m.round === maxR &&
    (m.status === 'ready' || m.status === 'live' || m.status === 'waiting'));
  if (open) return;
  if (maxR < t.cfg.rounds) { swissPairRound(t, maxR + 1); return; }
  swissFinishIfDone(t);
}

module.exports = {
  swissStandings, swissPairRound, swissMaxRound, swissProgress, swissGiveBye,
  swissFinishIfDone, swissAfterReport,
  swissCuts, swissCutRounds, swissRecord, swissActive, swissAdvanced, swissBoFor,
  swissStageDone, stageTwoCfg, stageTwoField, stageTwoBuild, setSwissHooks,
};
