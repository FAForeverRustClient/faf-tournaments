// Opponent pick phase: the top half of the seeds choose who they play in round one, instead of
// the bracket pairing them automatically. LotS has always done this by DM to the TD; this is the
// same thing on the site, with a clock so one absent player cannot stall the event.
//
// Shape (only present when a tournament opts in):
//   t.pickPhase = {
//     status:'open'|'done', field:[teamId...seed order], half:N,
//     order:[teamId...], picks:{ picker: target }, log:[...],
//     perPickMs: number|null, turnStartedAt: ms|null, startedAt, doneAt
//   }
// There is no background timer anywhere in this app, so the deadline is swept lazily: every
// read of the phase applies any pick whose clock has run out. That is the same idiom as
// scheduled publishing and qualification.
'use strict';

const { seedOrder, nextPow2 } = require('./bracket');

function pickPhaseOf(t) {
  const p = t && t.pickPhase;
  return (p && p.status) ? p : null;
}

/** Is n a power of two (and at least 4)? */
function fullBracket(n) { return n >= 4 && (n & (n - 1)) === 0; }

/**
 * Open the phase for an ordered field (best seed first). The top half pick, in seed order.
 *
 * The field MUST be a full bracket (4, 8, 16, 32...). With any other size the bracket has byes,
 * and a bye is a free win that nobody chose and nobody can pick - there is no honest way to say
 * whose opponent it is. Refusing is better than inventing a rule the players did not agree to.
 */
function startPickPhase(t, fieldIds, opts) {
  const o = opts || {};
  const field = (fieldIds || []).slice();
  if (!fullBracket(field.length)) return null;
  const half = field.length / 2;
  t.pickPhase = {
    status: 'open',
    field: field,
    half: half,
    order: field.slice(0, half),
    picks: {},
    log: [],
    perPickMs: o.perPickMs || null,
    turnStartedAt: o.perPickMs ? Date.now() : null,
    startedAt: Date.now(),
    doneAt: null
  };
  return t.pickPhase;
}

/** Everyone in the bottom half who has not been chosen yet. */
function availableTargets(t) {
  const p = pickPhaseOf(t);
  if (!p) return [];
  const taken = {};
  for (const k of Object.keys(p.picks)) taken[p.picks[k]] = 1;
  return p.field.slice(p.half).filter(id => !taken[id]);
}

/** Whose turn it is, or null when every pick is in. */
function currentPicker(t) {
  const p = pickPhaseOf(t);
  if (!p || p.status !== 'open') return null;
  for (const id of p.order) if (!p.picks[id]) return id;
  return null;
}

/**
 * The opponent the standard bracket would have given this picker. Used as the automatic choice
 * when someone's clock runs out, so "not picking" lands you exactly where you would have been
 * anyway rather than punishing you.
 */
function defaultTargetFor(t, pickerId) {
  const p = pickPhaseOf(t);
  if (!p) return null;
  const free = availableTargets(t);
  if (!free.length) return null;
  const size = nextPow2(p.field.length);
  const order = seedOrder(size);                        // 1-based seed positions
  const seedOf = id => p.field.indexOf(id) + 1;
  const mySeed = seedOf(pickerId);
  const at = order.indexOf(mySeed);
  if (at >= 0) {
    const partnerSeed = order[at % 2 === 0 ? at + 1 : at - 1];
    const partner = p.field[partnerSeed - 1];
    if (partner && free.indexOf(partner) >= 0) return partner;
  }
  // mirror already taken: the closest remaining seed to it
  const want = size + 1 - mySeed;
  return free.slice().sort((a, b) => Math.abs(seedOf(a) - want) - Math.abs(seedOf(b) - want))[0] || free[0];
}

/** ms left on the current pick, or null when there is no clock. */
function msLeft(t) {
  const p = pickPhaseOf(t);
  if (!p || p.status !== 'open' || !p.perPickMs || !p.turnStartedAt) return null;
  return Math.max(0, (p.turnStartedAt + p.perPickMs) - Date.now());
}

function recordPick(t, pickerId, targetId, byName, auto) {
  const p = pickPhaseOf(t);
  p.picks[pickerId] = targetId;
  p.log.push({ by: pickerId, byName: byName || '', target: targetId, at: Date.now(), auto: auto ? 1 : 0 });
  p.turnStartedAt = p.perPickMs ? Date.now() : null;
  if (!currentPicker(t)) { p.status = 'done'; p.doneAt = Date.now(); p.turnStartedAt = null; }
}

/**
 * Apply any pick whose clock has run out. Returns the list of automatic picks made, so the
 * caller can log them. Loops, because several clocks can have lapsed since the last read.
 */
function sweepPickDeadlines(t) {
  const p = pickPhaseOf(t);
  if (!p || p.status !== 'open' || !p.perPickMs) return [];
  const made = [];
  for (let guard = 0; guard < 64; guard++) {
    const who = currentPicker(t);
    if (!who) break;
    if (!p.turnStartedAt) { p.turnStartedAt = Date.now(); break; }
    if (Date.now() < p.turnStartedAt + p.perPickMs) break;
    const target = defaultTargetFor(t, who);
    if (!target) break;
    // The next picker's clock started the moment this one ran out, not now - otherwise a sweep
    // after a long gap would only ever resolve one lapsed pick per read.
    const lapsedAt = p.turnStartedAt + p.perPickMs;
    recordPick(t, who, target, 'Auto', true);
    if (p.status === 'open') p.turnStartedAt = lapsedAt;
    made.push({ by: who, target: target });
  }
  return made;
}

/**
 * The chosen pairings as first-round bracket slots. Takes the standard seeded layout and swaps
 * each top-half seed's partner for the opponent they picked, so the top seeds stay spread across
 * the bracket exactly as normal - only WHO they meet changes, not where they sit.
 */
function pickedSlots(t) {
  const p = pickPhaseOf(t);
  if (!p) return null;
  const size = nextPow2(p.field.length);
  const order = seedOrder(size);
  const slots = order.map(sd => (sd <= p.field.length ? p.field[sd - 1] : 'BYE'));
  const topHalf = {};
  p.field.slice(0, p.half).forEach(id => { topHalf[id] = 1; });
  for (let i = 0; i < slots.length; i += 2) {
    const a = slots[i], b = slots[i + 1];
    if (topHalf[a] && p.picks[a]) slots[i + 1] = p.picks[a];
    else if (topHalf[b] && p.picks[b]) slots[i] = p.picks[b];
  }
  return slots;
}

/** A view for the client: whose turn, what is left, and the pairings so far. */
function pickView(t, myTeamIds) {
  const p = pickPhaseOf(t);
  if (!p) return null;
  const mine = {};
  for (const id of (myTeamIds || [])) mine[id] = 1;
  const turn = currentPicker(t);
  return {
    status: p.status,
    half: p.half,
    field: p.field.slice(),
    order: p.order.slice(),
    picks: Object.assign({}, p.picks),
    available: availableTargets(t),
    turn: turn,
    myTurn: !!(turn && mine[turn]),
    msLeft: msLeft(t),
    perPickMs: p.perPickMs || null,
    log: p.log.slice(-40),
    doneAt: p.doneAt || null
  };
}

module.exports = {
  fullBracket, pickPhaseOf, startPickPhase, availableTargets, currentPicker, defaultTargetFor,
  msLeft, recordPick, sweepPickDeadlines, pickedSlots, pickView
};
