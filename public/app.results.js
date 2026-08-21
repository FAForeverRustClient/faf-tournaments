// ----- report score -----

function reportScore(matchId) {
  const m = T.matches.find(x => x.id === matchId);
  if (!m) return;
  if (m.bracket === 'ffa') return reportFfa(matchId);
  if (viewerIsOrganizer()) return reportScoreAdmin(m);
  return reportScorePlayer(m);
}

// organizer: direct report (overrides anything, clears pending submissions)
function reportScoreAdmin(m) {
  const maxW = Math.ceil(m.bo / 2);
  const maps = mapsFor(m.bracket, m.round);
  const pr = m.pendingReport;
  modal(`
    <h3>Report score — ${esc(roundLabel(m))}</h3>
    <p class="muted small">Best of ${m.bo} — first to ${maxW}.${m.hcap ? ' Upper bracket finalist starts 1-0 up.' : ''} Organizer report: applies immediately and overrides player submissions.</p>
    ${pr ? '<p class="warn small">Pending player submission: ' + pr.score1 + '–' + pr.score2 + ' by ' + esc(pr.byName || '') + ' — <button class="btn primary small" id="rAccept">Accept it</button> <button class="btn ghost small" id="rReject">Reject it</button></p>' : ''}
    ${maps.length ? '<div class="mapblock"><div class="mapblock-head"><span>MAP POOL</span></div>' + mapRows(maps) + '</div>' : ''}
    <div class="row">
      <div style="flex:1"><label>${esc(teamName(m.team1))}</label><input type="number" id="rs1" min="${m.hcap ? 1 : 0}" max="${maxW}" value="${(m.score1 != null && m.score1 >= 0) ? m.score1 : (m.hcap ? 1 : 0)}"></div>
      <div style="flex:1"><label>${esc(teamName(m.team2))}</label><input type="number" id="rs2" min="0" max="${maxW}" value="${(m.score2 != null && m.score2 >= 0) ? m.score2 : 0}"></div>
    </div>
    <label style="margin-top:10px">Replay IDs <span class="muted small">(optional, comma-separated \u2014 one per game, kept for the archive)</span></label>
    <input type="text" id="rReplays" inputmode="numeric" value="${esc((m.replayIds || []).join(', '))}" autocomplete="off" placeholder="e.g. 21534001, 21534050">
    <label style="margin-top:10px">Draw replay IDs <span class="muted small">(optional \u2014 games that ended drawn and were replayed)</span></label>
    <input type="text" id="rDrawReplays" inputmode="numeric" value="${esc((m.drawReplayIds || []).join(', '))}" autocomplete="off" placeholder="e.g. 21534010">
    <div class="ff-block">
      <label>Winner <span class="muted small">(only needed if the score doesn't decide it \u2014 e.g. 1\u20131 and someone forfeited)</span></label>
      <div class="row" style="gap:8px">
        <button type="button" class="btn ghost small win-pick" data-win="${esc(m.team1)}">${esc(teamName(m.team1))}</button>
        <button type="button" class="btn ghost small win-pick" data-win="${esc(m.team2)}">${esc(teamName(m.team2))}</button>
        <button type="button" class="btn ghost small win-pick" data-win="">By score</button>
      </div>
      <label style="margin-top:8px"><input type="checkbox" id="rFfChk"> Mark this result as a forfeit</label>
    </div>
    <div class="actions">
      <button class="btn ghost" id="rCancel">Cancel</button>
      <button class="btn primary" id="rGo">Save score</button>
    </div>`, root => {
    root.querySelector('#rCancel').onclick = closeModal;
    // Replay IDs are FAF replay numbers. Keep digits and separators only, so pasting a URL or a
    // messy list drops the junk here instead of being silently stripped on save.
    ['#rReplays', '#rDrawReplays'].forEach(sel => {
      const inp2 = root.querySelector(sel);
      if (!inp2) return;
      const clean = () => {
        const before = inp2.value;
        const after = before.replace(/[^0-9,\s]/g, '').replace(/\s*,\s*/g, ', ');
        if (after !== before) {
          const atEnd = inp2.selectionStart === before.length;
          inp2.value = after;
          if (atEnd) inp2.setSelectionRange(after.length, after.length);
        }
      };
      inp2.addEventListener('input', clean);
      inp2.addEventListener('paste', () => setTimeout(clean, 0));
    });
    // winner picker: highlight the chosen team; '' means decide by score
    let chosenWinner = m.winner || '';
    const paintWin = () => root.querySelectorAll('.win-pick').forEach(b => b.classList.toggle('on', b.dataset.win === chosenWinner));
    root.querySelectorAll('.win-pick').forEach(b => b.onclick = () => { chosenWinner = b.dataset.win; paintWin(); });
    paintWin();
    const conf = async (accept) => {
      try { await api('/api/t/' + T.id + '/report_confirm', { matchId: m.id, accept: accept ? 1 : 0, admin: adminToken(), token: myToken() }); closeModal(); toast(accept ? 'Accepted' : 'Rejected'); await refresh(); }
      catch (e) { toast(e.message, true); }
    };
    const ra = root.querySelector('#rAccept'); if (ra) ra.onclick = () => conf(true);
    const rr = root.querySelector('#rReject'); if (rr) rr.onclick = () => conf(false);
    root.querySelector('#rGo').onclick = async () => {
      try {
        const ff = root.querySelector('#rFfChk').checked;
        await api('/api/t/' + T.id + '/report', {
          matchId: m.id,
          score1: root.querySelector('#rs1').value,
          score2: root.querySelector('#rs2').value,
          winner: chosenWinner || undefined,
          forfeit: (ff && chosenWinner) ? (chosenWinner === m.team1 ? m.team2 : m.team1) : undefined,
          replayIds: root.querySelector('#rReplays').value.split(',').map(s => s.trim()).filter(Boolean),
          drawReplayIds: root.querySelector('#rDrawReplays').value.split(',').map(s => s.trim()).filter(Boolean),
          token: myToken()
        });
        closeModal();
        toast('Score saved');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// player: submit with replay IDs -> opponent confirms
function reportScorePlayer(m) {
  const mine = myMatchTeam(m);
  if (!mine) return;
  const pr = m.pendingReport;
  // pending against MY team -> confirm/reject screen
  if (pr && pr.byTeam !== mine) {
    modal(`
      <h3>Confirm score — ${esc(roundLabel(m))}</h3>
      <p><strong>${esc(teamName(pr.byTeam))}</strong> reported <strong>${esc(teamName(m.team1))} ${pr.score1} – ${pr.score2} ${esc(teamName(m.team2))}</strong>.</p>
      <p class="muted small">Replay ID${pr.replayIds.length === 1 ? '' : 's'}: ${pr.replayIds.map(esc).join(', ')}</p>
      ${(pr.drawReplayIds && pr.drawReplayIds.length) ? '<p class="muted small">Draw replay' + (pr.drawReplayIds.length === 1 ? '' : 's') + ' (replayed, no score): ' + pr.drawReplayIds.map(esc).join(', ') + '</p>' : ''}
      <div class="actions">
        <button class="btn ghost" id="rcNo">Reject</button>
        <button class="btn primary" id="rcYes">Confirm</button>
      </div>`, root => {
      const act = async (accept) => {
        try { await api('/api/t/' + T.id + '/report_confirm', { matchId: m.id, accept: accept ? 1 : 0, token: myToken() }); closeModal(); toast(accept ? 'Confirmed' : 'Rejected'); await refresh(); }
        catch (e) { toast(e.message, true); }
      };
      root.querySelector('#rcYes').onclick = () => act(true);
      root.querySelector('#rcNo').onclick = () => act(false);
    });
    return;
  }
  if (pr) {
    modal(`<h3>Score submitted</h3>
      <p class="muted small">Your team reported <strong>${pr.score1} – ${pr.score2}</strong>. Waiting for the opponent (or an organizer) to confirm. Submitting again replaces it.</p>
      <div class="actions"><button class="btn ghost" id="rcClose">Close</button><button class="btn primary" id="rcAgain">Submit a new score</button></div>`, root => {
      root.querySelector('#rcClose').onclick = closeModal;
      root.querySelector('#rcAgain').onclick = () => { closeModal(); openPlayerSubmit(m, mine); };
    });
    return;
  }
  openPlayerSubmit(m, mine);
}

function openPlayerSubmit(m, mine) {
  const maxW = Math.ceil(m.bo / 2);
  const cur1 = m.score1 != null ? m.score1 : (m.hcap ? 1 : 0);
  const cur2 = m.score2 != null ? m.score2 : 0;
  const maps = mapsFor(m.bracket, m.round);
  modal(`
    <h3>Submit score — ${esc(roundLabel(m))}</h3>
    <p class="muted small">Best of ${m.bo} — first to ${maxW}. Confirmed so far: <strong>${cur1} – ${cur2}</strong>.
    Enter the score as it stands now; you must give one <strong>replay ID</strong> per new game, and the opponent confirms before it counts.</p>
    ${maps.length ? '<div class="mapblock"><div class="mapblock-head"><span>MAP POOL</span></div>' + mapRows(maps) + '</div>' : ''}
    <div class="row">
      <div style="flex:1"><label>${esc(teamName(m.team1))}</label><input type="number" id="ps1" min="${m.hcap ? 1 : 0}" max="${maxW}" value="${cur1}"></div>
      <div style="flex:1"><label>${esc(teamName(m.team2))}</label><input type="number" id="ps2" min="0" max="${maxW}" value="${cur2}"></div>
    </div>
    <div id="psReplays" style="margin-top:10px"></div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" id="psDraw"> A game ended in a draw (was replayed)</label>
    <div id="psDrawWrap" style="display:none;margin-top:6px">
      <label>Draw replay ID(s) <span class="muted small">(comma-separated — draws score nothing, but casters and the archive want the replays)</span></label>
      <input type="text" id="psDrawIds" autocomplete="off" placeholder="e.g. 21534010, 21534044">
    </div>
    <div class="actions">
      <button class="btn ghost" id="psCancel">Cancel</button>
      <button class="btn primary" id="psGo">Submit for confirmation</button>
    </div>`, root => {
    const drawCb = root.querySelector('#psDraw');
    drawCb.onchange = () => { root.querySelector('#psDrawWrap').style.display = drawCb.checked ? '' : 'none'; };
    const wrap = root.querySelector('#psReplays');
    const redraw = () => {
      const s1 = parseInt(root.querySelector('#ps1').value, 10) || 0;
      const s2 = parseInt(root.querySelector('#ps2').value, 10) || 0;
      const n = Math.max(0, (s1 + s2) - (cur1 + cur2));
      wrap.innerHTML = n ? '<label>Replay ID' + (n === 1 ? '' : 's') + ' <span class="muted small">(one per new game, from the FAF client or replay vault)</span></label>' +
        Array.from({ length: n }, (_, i) => '<input type="text" class="psRid" maxlength="24" placeholder="Replay ID for game ' + (cur1 + cur2 + i + 1) + '" autocomplete="off" style="margin-bottom:6px">').join('')
        : '<p class="muted small">Raise a score to report new games.</p>';
    };
    redraw();
    root.querySelector('#ps1').addEventListener('input', redraw);
    root.querySelector('#ps2').addEventListener('input', redraw);
    root.querySelector('#psCancel').onclick = closeModal;
    root.querySelector('#psGo').onclick = async () => {
      const replayIds = Array.from(root.querySelectorAll('.psRid')).map(i => i.value.trim());
      if (replayIds.some(v => !v)) return toast('Fill in every replay ID', true);
      try {
        await api('/api/t/' + T.id + '/report_submit', {
          matchId: m.id,
          score1: root.querySelector('#ps1').value,
          score2: root.querySelector('#ps2').value,
          replayIds,
          drawReplayIds: drawCb.checked ? root.querySelector('#psDrawIds').value.split(',').map(v => v.trim()).filter(Boolean) : [],
          token: myToken()
        });
        closeModal();
        toast('Submitted — waiting for the opponent to confirm');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

function reportFfa(matchId) {
  const m = T.matches.find(x => x.id === matchId);
  if (!m) return;
  if (T.ffaCfg.mode === 'points' && !m.isFinal) return reportFfaPoints(m);
  const roundCount = T.matches.filter(x => x.bracket === 'ffa' && x.round === m.round).length;
  const need = m.isFinal ? 1 : (roundCount === 1 ? 1 : Math.min(T.ffaCfg.advance, m.entrants.length - 1));
  modal(`
    <h3>Report result — Lobby ${m.index + 1}</h3>
    <p class="muted small">Tick the ${need === 1 ? 'winner' : 'top ' + need}.</p>
    <div class="pick-list" id="ffaWinners">
      ${m.entrants.map(id => `<button type="button" class="pick-item${m.winners && m.winners.indexOf(id) >= 0 ? ' on' : ''}" data-tid="${id}">${esc(teamName(id))}</button>`).join('')}
    </div>
    <div class="actions">
      <button class="btn ghost" id="rCancel">Cancel</button>
      <button class="btn primary" id="rGo">Save result</button>
    </div>`, root => {
    // clicking a name toggles it; don't allow more than the number of winners needed
    root.querySelectorAll('#ffaWinners .pick-item').forEach(btn => btn.onclick = () => {
      if (!btn.classList.contains('on') && root.querySelectorAll('#ffaWinners .pick-item.on').length >= need) {
        return toast('Pick exactly ' + need + ' — unselect one first', true);
      }
      btn.classList.toggle('on');
    });
    root.querySelector('#rCancel').onclick = closeModal;
    root.querySelector('#rGo').onclick = async () => {
      const winners = Array.from(root.querySelectorAll('#ffaWinners .pick-item.on')).map(b => b.dataset.tid);
      if (winners.length !== need) return toast('Select exactly ' + need, true);
      try {
        await api('/api/t/' + T.id + '/report', { matchId, winners, token: myToken() });
        closeModal();
        toast('Result saved');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

function reportFfaPoints(m) {
  modal(`
    <h3>Report result — Lobby ${m.index + 1}</h3>
    <p class="muted small">Enter each ${T.teamSize === 1 ? 'player' : 'team'}'s points for this round (e.g. by placement).</p>
    ${m.entrants.map(id => `
      <div class="row" style="align-items:center;gap:10px;margin:8px 0">
        <div style="flex:1">${esc(teamName(id))}</div>
        <input type="number" class="ffaPts" data-id="${id}" min="0" max="1000" style="flex:0 0 100px" value="${m.points && m.points[id] != null ? m.points[id] : ''}" placeholder="pts" autocomplete="off">
      </div>`).join('')}
    <div class="actions">
      <button class="btn ghost" id="rCancel">Cancel</button>
      <button class="btn primary" id="rGo">Save result</button>
    </div>`, root => {
    root.querySelector('#rCancel').onclick = closeModal;
    root.querySelector('#rGo').onclick = async () => {
      const points = {};
      for (const inp of root.querySelectorAll('.ffaPts')) {
        if (inp.value === '') return toast('Enter points for everyone (0 is fine)', true);
        points[inp.dataset.id] = inp.value;
      }
      try {
        await api('/api/t/' + T.id + '/report', { matchId: m.id, points, token: myToken() });
        closeModal();
        toast('Result saved');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// ----- standings -----

// Challonge group-stage tables and final placements, for imported tournaments.
function importedTablesHTML() {
  let h = '';
  for (const g of (T.importedGroups || [])) {
    h += `<div class="panel section"><h2>${esc(g.name)}</h2>
      <table class="mt-table"><thead><tr><th>#</th><th>Player</th><th>W\u2013L</th><th>Games</th></tr></thead><tbody>
      ${g.rows.map((r, i) => `<tr>
        <td class="mt-fixed mono small muted">${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td class="mt-fixed mono">${r.w}\u2013${r.l}</td>
        <td class="mt-fixed mono muted">${r.gw}\u2013${r.gl}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
  }
  if ((T.importedStandings || []).length) {
    h += `<div class="panel section"><h2>Final placings</h2>
      <div class="st-list">${T.importedStandings.map(r => `<div class="st-row">
        <span class="st-rank">${r.rank}</span><span class="st-name">${esc(r.name)}</span>
      </div>`).join('')}</div>
      <p class="muted small" style="margin-top:8px">Placings as recorded on Challonge.</p></div>`;
  }
  return h;
}

function drawStandings(el) {
  if (streamerMode) {
    el.innerHTML = '<div class="panel"><div class="empty">Standings are hidden while streamer mode is on (it would reveal results). Toggle it off in the header to view them.</div></div>';
    return;
  }
  // an imported event's own tables come first (and may be all there is)
  const impHtml = T.imported ? importedTablesHTML() : '';
  if (T.imported && impHtml) {
    el.innerHTML = impHtml;
    return;
  }
  if (T.status !== 'running' && T.status !== 'finished') {
    el.innerHTML = '<div class="panel"><div class="empty">Standings appear once matches begin.</div></div>';
    return;
  }

  if (T.bracketType === 'swiss' && T.competition === 'team') {
    // recompute swiss table client-side
    const S = {};
    for (const team of T.teams) S[team.id] = { id: team.id, w: 0, l: 0, gd: 0 };
    for (const m of T.matches) {
      if (m.bracket !== 'sw') continue;
      if (m.status === 'bye') { const id = m.team1 !== 'BYE' ? m.team1 : m.team2; if (S[id]) { S[id].w++; S[id].gd += 1; } }
      else if (m.status === 'done') {
        const ws = m.winner === m.team1 ? m.score1 : m.score2;
        const ls = m.winner === m.team1 ? m.score2 : m.score1;
        if (S[m.winner]) { S[m.winner].w++; S[m.winner].gd += ws - ls; }
        if (S[m.loser]) { S[m.loser].l++; S[m.loser].gd -= ws - ls; }
      }
    }
    const rows = Object.values(S).sort((a, b) => b.w - a.w || b.gd - a.gd || teamSeed(a.id) - teamSeed(b.id));
    el.innerHTML = `<div class="panel section"><h2>Swiss <span class="h2-strong">Standings</span></h2>
      <table><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>Game diff</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${i === 0 ? 'rank1' : i === 1 ? 'rank2' : i === 2 ? 'rank3' : ''}">
        <td class="mono">${i + 1}</td><td>${esc(teamName(r.id))}${T.championTeamId === r.id ? ' 🏆' : ''}</td>
        <td class="mono">${r.w}</td><td class="mono">${r.l}</td><td class="mono">${r.gd > 0 ? '+' : ''}${r.gd}</td></tr>`).join('')}
      </tbody></table></div>`;
    return;
  }

  if (T.competition === 'ffa' && T.ffaCfg.mode === 'points') {
    const tot = {};
    for (const team of T.teams) tot[team.id] = 0;
    for (const m of T.matches) {
      if (m.bracket !== 'ffa' || !m.points) continue;
      for (const id of Object.keys(m.points)) if (tot[id] !== undefined) tot[id] += m.points[id];
    }
    const rows = T.teams.slice().sort((a, b) =>
      (T.championTeamId === b.id) - (T.championTeamId === a.id) || tot[b.id] - tot[a.id] || a.seed - b.seed);
    el.innerHTML = `<div class="panel section"><h2>Points <span class="h2-strong">Standings</span></h2>
      <table><thead><tr><th>#</th><th>${T.teamSize === 1 ? 'Player' : 'Team'}</th><th>Points</th><th></th></tr></thead><tbody>
      ${rows.map((team, i) => `<tr class="${i === 0 ? 'rank1' : i === 1 ? 'rank2' : i === 2 ? 'rank3' : ''}">
        <td class="mono">${i + 1}</td><td>${esc(team.name)}${T.championTeamId === team.id ? ' \ud83c\udfc6' : ''}</td>
        <td class="mono">${tot[team.id]}</td>
        <td class="small muted">${team.out ? 'Cut after round ' + team.out.round : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
    return;
  }

  // imported tournaments: use Challonge's final_rank directly (handles ties)
  if (T.imported) {
    const rows = T.teams.slice().sort((a, b) => (a.finalRank || 999) - (b.finalRank || 999) || a.seed - b.seed);
    const html = rows.map(team => {
      const rk = team.finalRank || '\u2014';
      const cls = rk === 1 ? 'rank1' : rk === 2 ? 'rank2' : rk === 3 ? 'rank3' : '';
      const note = team.id === T.championTeamId ? '\ud83c\udfc6 Champion' : '';
      return `<tr class="${cls}"><td class="mono">${rk}</td><td>${esc(team.name)}</td><td class="small muted">${note}</td></tr>`;
    }).join('');
    el.innerHTML = `<div class="panel section"><h2>Final <span class="h2-strong">Standings</span></h2>
      <table><thead><tr><th>Place</th><th>Team</th><th></th></tr></thead><tbody>${html}</tbody></table></div>`;
    return;
  }

  // elimination formats: rank by how far each team got
  const stage = team => {
    if (T.championTeamId === team.id) return 1e9;
    if (!team.out) return 1e8; // still alive
    if (team.out.bracket === 'gf') return 1e6;
    if (team.out.bracket === 'lb') return 1000 + team.out.round;
    return team.out.round; // wb (single elim) or ffa round
  };
  const rows = T.teams.slice().sort((a, b) => stage(b) - stage(a) || a.seed - b.seed);
  let rank = 0, prevStage = null, shown = 0;
  const html = rows.map(team => {
    shown++;
    const st = stage(team);
    if (st !== prevStage) { rank = shown; prevStage = st; }
    const label = T.championTeamId === team.id ? '1' : (!team.out ? '—' : String(rank));
    const note = T.championTeamId === team.id ? '🏆 Champion' : (!team.out ? 'Still in' :
      team.out.bracket === 'gf' ? 'Lost the final' :
      'Out in ' + roundKeyLabel(team.out.bracket, team.out.round).toLowerCase());
    return `<tr class="${label === '1' ? 'rank1' : label === '2' ? 'rank2' : (label === '3' ? 'rank3' : '')}">
      <td class="mono">${label}</td><td>${esc(team.name)}</td><td class="small muted">${esc(note)}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="panel section"><h2>Standings</h2>
    <table><thead><tr><th>Place</th><th>${T.teamSize === 1 ? 'Player' : 'Team'}</th><th>Result</th></tr></thead>
    <tbody>${html}</tbody></table></div>`;
}

// ----- admin -----

async function drawAdmin(el) {
  el.innerHTML = '<div class="panel"><div class="empty">Loading…</div></div>';
  let secrets = null;
  try {
    const at = adminToken();
    secrets = await api('/api/t/' + T.id + '/secrets' + (at ? '?admin=' + encodeURIComponent(at) : ''));
  }
  catch (e) { el.innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>'; return; }

  const base = location.origin + '/t/' + T.id;
  const copyRow = (label, value) => `
    <label>${esc(label)}</label>
    <div class="copybox"><input type="text" readonly value="${esc(value)}"><button class="btn small" data-copy="${esc(value)}">Copy</button></div>`;

  let html = `<div class="panel section"><h2>Share links</h2>
    ${copyRow('Public link — share with everyone', base)}
    ${copyRow('Late-signup link — lets someone sign up after signups close (they must log in)', base + '?late=' + secrets.lateToken)}

  </div>`;

  { // Tournament details — name, dates, team counts — editable any time
    const dv = splitDateTimeUTC(T.eventDate || '');
    const su = splitDateTimeUTC(T.signupOpensAt || '');
    const sc = splitDateTimeUTC(T.signupClosesAt || '');
    // checkInDeadline is stored as an epoch ms number, unlike the other three (ISO strings).
    const ci = splitDateTimeUTC(T.checkInDeadline ? new Date(T.checkInDeadline).toISOString() : '');
    html += `<div class="panel section"><h2>Tournament details</h2>
      <p class="muted small">Times are in <strong>UTC</strong> and display in each viewer's own time zone. All editable at any time.</p>
      <label>Tournament name</label>
      <input type="text" id="td_name" maxlength="60" value="${esc(T.name || '')}">
      ${T.imported ? '' : `<label style="margin-top:12px">Event date &amp; time</label>
      <div style="display:flex;gap:8px"><input type="date" id="td_date" value="${esc(dv.date)}" style="flex:1"><input type="time" id="td_time" value="${esc(dv.time)}" style="width:130px"></div>
      <label style="margin-top:12px">Signups open at <span class="muted small">(before this, only organizers can add players)</span></label>
      <div style="display:flex;gap:8px"><input type="date" id="td_sudate" value="${esc(su.date)}" style="flex:1"><input type="time" id="td_sutime" value="${esc(su.time)}" style="width:130px"></div>
      <label style="margin-top:12px">Signups close at <span class="muted small">(auto-closes signups; team forming &amp; picks still work. Empty = manual)</span></label>
      <div style="display:flex;gap:8px"><input type="date" id="td_scdate" value="${esc(sc.date)}" style="flex:1"><input type="time" id="td_sctime" value="${esc(sc.time)}" style="width:130px"></div>
      <label style="margin-top:12px">Check-in deadline <span class="muted small">(any member of a full team can check it in. Empty = no check-in; teams enter by signup order)</span></label>
      <div style="display:flex;gap:8px"><input type="date" id="td_cidate" value="${esc(ci.date)}" style="flex:1"><input type="time" id="td_citime" value="${esc(ci.time)}" style="width:130px"></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
        <div style="flex:1;min-width:150px"><label>Min teams / entrants <span class="muted small">(display only)</span></label><input type="number" id="td_min" min="0" max="128" value="${T.minTeams || 0}"></div>
        <div style="flex:1;min-width:150px"><label>Max teams / entrants <span class="muted small">(0 = unlimited)</span></label><input type="number" id="td_max" min="0" max="128" value="${T.maxTeams || 0}"></div>
      </div>`}
      <div style="margin-top:14px"><button class="btn amber" id="td_save">Save details</button></div>
    </div>`;
  }

  { // Organizers: always visible in the Admin tab, even when the identity list is empty
    const sa = !!siteAdmin();
    const orgs = T.organizers || [];
    // Qualifiers are a niche feature, so the controls stay collapsed behind a checkbox unless
    // this tournament already uses them.
    const isParent = (T.qualifiers || []).length > 0 || _qlPanelOpen;
    html += `<div class="panel section"><h2>Qualifiers</h2>
      <label class="ql-toggle"><input type="checkbox" id="qlEnable"${isParent ? ' checked' : ''}> This tournament takes qualifiers from other tournaments</label>
      <div id="qlBody" style="display:${isParent ? '' : 'none'}">
        <p class="muted small" style="margin:8px 0 10px">When a linked qualifier finishes, the entrants who meet the rule are <strong>invited</strong> automatically \u2014 they still have to accept. Manual invites and normal signups keep working.</p>
        ${(T.qualifiers || []).length ? '<div class="ql-list">' + T.qualifiers.map(q => `<div class="ql-row">
            <div>
              <div class="ql-name">${esc(q.name)}</div>
              <div class="muted small">${q.rule ? (q.rule.type === 'points' ? q.rule.n + '+ points advance' : 'Top ' + q.rule.n + ' advance') : ''}
                \u00b7 ${q.applied ? 'applied \u2014 ' + (q.qualified || []).length + ' qualified' : (q.status === 'finished' ? 'pending' : 'waiting for it to finish')}</div>
              ${(q.qualified || []).length ? '<div class="muted small">Qualified: ' + esc(q.qualified.join(', ')) + '</div>' : ''}
              ${(q.unreachable || []).length ? '<div class="warn small">No FAF account \u2014 invite manually: ' + esc(q.unreachable.join(', ')) + '</div>' : ''}
            </div>
            <button class="btn ghost small" data-qlrm="${esc(q.id)}">Remove</button>
          </div>`).join('') + '</div>' : ''}
        <div class="ql-add">
          <div class="ql-pick">
            <label>Qualifier tournament <span class="muted small">(only tournaments you organize)</span></label>
            <input type="text" id="qlSearch" placeholder="Search your tournaments\u2026" autocomplete="off">
            <div class="ql-opts" id="qlOpts" style="display:none"></div>
          </div>
          <div style="width:150px"><label>Rule</label><select id="qlType"><option value="top">Top N advance</option><option value="points">N+ points</option></select></div>
          <div style="width:74px"><label>N</label><input type="number" id="qlN" min="1" max="128" value="4"></div>
          <button class="btn ghost" id="qlAdd">Add</button>
        </div>
      </div>
    </div>`;
    html += `<div class="panel section"><h2>Series</h2>
      <p class="muted small">Group this tournament with other editions of the same recurring event. Editions stay completely independent — this is only a link for browsing.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <select id="tSeriesSel" style="flex:1;min-width:220px"><option value="">— not part of a series —</option></select>
        <button class="btn ghost" id="tSeriesSave">Save</button>
        <a href="/series" data-serieslink class="muted small">Browse series</a>
      </div>
      ${T.seriesName ? '<p class="muted small" style="margin-top:8px">Currently in <strong>' + esc(T.seriesName) + '</strong>.</p>' : ''}
    </div>`;
    html += `<div class="panel section"><h2>Organizers <span class="h2-strong">(${orgs.length})</span></h2>
      <p class="muted small">Accounts with organizer rights on this tournament${sa ? ' — as site admin you can remove them' : ''}.</p>
      <p class="muted small">Add an organizer below by FAF name or id. Any organizer can add co-organizers; only a site admin can remove one. Players see the visible organizers on the Chat tab; hide one to keep them off that public list (default: shown).</p>
      ${orgs.length ? '' : '<div class="empty" style="margin:10px 0">No FAF account holds organizer rights here yet. Add one below by FAF name or id.</div>'}
      <div class="pick-rows" style="margin-top:10px">${orgs.map(o => `<div class="pick-row on" style="cursor:default">
        <span class="pr-name">${esc(o.name)} <span class="muted small">FAF id ${esc(o.fafId)}</span> ${o.hidden ? '<span class="idbadge late" title="Not shown to players">hidden</span>' : ''}</span>
        <button class="btn ghost small" data-orgvis="${esc(o.fafId)}" data-hidden="${o.hidden ? 1 : 0}">${o.hidden ? 'Show to players' : 'Hide from players'}</button>
        ${sa ? '<button class="btn danger small" data-orgdel="' + esc(o.fafId) + '">Remove</button>' : ''}
      </div>`).join('')}</div>
      <div style="margin-top:10px">
        ${fafAuth.user && (sa || (fafAuth.user.director && T.category === 'official')) && !orgs.some(o => o.fafId === fafAuth.user.fafId) ? '<button class="btn ghost small" id="orgClaimSelf" style="margin-bottom:10px">+ Add myself (' + esc(fafAuth.user.fafName || '') + ')</button>' : ''}
        <div id="orgAdd"></div>
      </div></div>`;

    const casters = T.casters || [];
    html += `<div class="panel section"><h2>Casters</h2>
      <p class="muted small">Read access to everything on this tournament: every chat room (and they can post in them), hidden maps and pools, and all vetoes. No organizer powers at all \u2014 no Admin tab, no Log, no player changes.</p>
      <p class="muted small">Bound to a FAF account, so it works in the desktop client too. Any organizer can add or remove a caster.</p>
      ${casters.length ? '' : '<div class="empty" style="margin:10px 0">No casters yet. Add one below by FAF name or id.</div>'}
      <div class="pick-rows" style="margin-top:10px">${casters.map(c => `<div class="pick-row on" style="cursor:default">
        <span class="pr-name">${esc(c.name)} <span class="muted small">FAF id ${esc(c.fafId)}</span></span>
        <button class="btn danger small" data-casterdel="${esc(c.fafId)}">Remove</button>
      </div>`).join('')}</div>
      <div style="margin-top:10px"><div id="casterAdd"></div></div></div>`;
  }

  if (['signup', 'draft', 'drafted'].indexOf(T.status) >= 0) {
    const locked = T.status !== 'signup';
    const boSel = (id, val) => `<select id="${id}">${[1,3,5,7].map(o => '<option value="' + o + '"' + (o === val ? ' selected' : '') + '>Bo' + o + '</option>').join('')}</select>`;
    const p = T.plan || {};
    const fc = T.ffaCfg || {};
    const dis = locked ? ' disabled' : '';
    html += `<div class="panel section"><h2>Format</h2>
      ${locked ? '<p class="muted small">Team setup fields are locked while the draft/teams exist \u2014 reopen signups to change them. Bracket, match lengths and caps stay editable until the bracket starts.</p>' : '<p class="muted small">Fix wrong options here. Everything is editable until the bracket starts.</p>'}
      <label>Competition</label>
      <select id="af_comp"${dis}><option value="team"${T.competition === 'team' ? ' selected' : ''}>Team bracket</option><option value="ffa"${T.competition === 'ffa' ? ' selected' : ''}>FFA</option></select>
      <div id="af_team">
        <label>Team size</label>
        <select id="af_size"${dis}>${[1,2,3,4,5,6].map(n => '<option value="' + n + '"' + (n === T.teamSize && T.competition === 'team' ? ' selected' : '') + '>' + n + 'v' + n + '</option>').join('')}</select>
        <div id="af_formWrap">
          <label>Team formation</label>
          <select id="af_form"${dis}><option value="draft"${T.formation === 'draft' ? ' selected' : ''}>Captains draft</option><option value="open"${T.formation !== 'draft' ? ' selected' : ''}>Premade teams</option></select>
          <div id="af_orderWrap">
            <label>Draft pick order</label>
            <select id="af_order"${dis}><option value="linear"${T.draftOrder !== 'snake' ? ' selected' : ''}>Bottom to top, every round</option><option value="snake"${T.draftOrder === 'snake' ? ' selected' : ''}>Snake (1\u2192N, N\u21921, ...)</option></select>
          </div>
        </div>
        <label>Bracket</label>
        <select id="af_bt"><option value="single"${T.bracketType === 'single' ? ' selected' : ''}>Single elimination</option><option value="double"${T.bracketType === 'double' ? ' selected' : ''}>Double elimination</option><option value="swiss"${T.bracketType === 'swiss' ? ' selected' : ''}>Swiss</option></select>
        <label id="af_perRoundWrap" style="display:${T.bracketType === 'swiss' ? 'none' : 'flex'};align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:12px">
          <input type="checkbox" id="af_perRound"${T.perRoundBo ? ' checked' : ''}> Set a different Bo for every round individually (on the Bracket tab)
        </label>
        <div id="af_perRoundNote" class="muted small" style="display:${T.perRoundBo ? 'block' : 'none'};margin:4px 0 4px">Per-round Bo is managed on the <strong>Bracket</strong> tab \u2014 set each round there (works before and after the bracket is generated). The preset lengths below are hidden while this is on.</div>
        <div id="af_pSingle">
          <label>Match lengths</label>
          <div class="row" style="gap:10px">
            <div style="flex:1"><div class="muted small">Early rounds</div>${boSel('af_early', p.early || 3)}</div>
            <div style="flex:1"><div class="muted small">Semifinal</div>${boSel('af_semi', p.semi || 3)}</div>
            <div style="flex:1"><div class="muted small">Final</div>${boSel('af_final', p.final || 5)}</div>
          </div>
        </div>
        <div id="af_pDouble" style="display:none">
          <label>Match lengths</label>
          <div class="row" style="gap:10px">
            <div style="flex:1"><div class="muted small">Winners bracket rounds</div>${boSel('af_wb', p.wb || 3)}</div>
            <div style="flex:1"><div class="muted small">Winners bracket final</div>${boSel('af_wbf', p.wbFinal || 3)}</div>
          </div>
          <div class="row" style="gap:10px;margin-top:8px">
            <div style="flex:1"><div class="muted small">Losers bracket rounds</div>${boSel('af_lb', p.lb || 3)}</div>
            <div style="flex:1"><div class="muted small">Losers bracket final</div>${boSel('af_lbf', p.lbFinal || 3)}</div>
          </div>
          <div class="row" style="gap:10px;margin-top:8px"><div style="flex:1"><div class="muted small">Grand final</div>${boSel('af_gf', p.gf || 5)}</div></div>
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
            <input type="checkbox" id="af_hcap"${p.lbHandicap || p.lbHandicap === undefined ? ' checked' : ''}> Upper bracket finalist starts the grand final 1-0 up
          </label>
        </div>
        <div id="af_pSwiss" style="display:none">
          <label>Match lengths</label>
          <div class="row" style="gap:10px">
            <div style="flex:1"><div class="muted small">Each match</div><select id="af_swbo"><option value="1"${p.bo === 1 ? ' selected' : ''}>Bo1</option><option value="3"${p.bo !== 1 ? ' selected' : ''}>Bo3</option></select></div>
            <div style="flex:1"><div class="muted small">Final</div>${boSel('af_swfbo', p.finalBo || 5)}</div>
          </div>
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
            <input type="checkbox" id="af_swfinal"${p.final === 0 ? '' : ' checked'}> Final between the top 2 after the last round
          </label>
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
            <input type="checkbox" id="af_swfast"${p.fast ? ' checked' : ''}> Fast pairing \u2014 next matchup starts as soon as two teams are free
          </label>
        </div>
      </div>
      <div id="af_ffa" style="display:none">
        <label>Entrants</label>
        <select id="af_fsize"${dis}>${[1,2,3].map(n => '<option value="' + n + '"' + (n === T.teamSize && T.competition === 'ffa' ? ' selected' : '') + '>' + (n === 1 ? 'Solo players' : 'Teams of ' + n) + '</option>').join('')}</select>
        <label id="af_pmLabel">Players per FFA lobby</label>
        <select id="af_pm"></select>
        <label>Mode</label>
        <select id="af_fmode"><option value="points"${fc.mode !== 'elim' ? ' selected' : ''}>Points over rounds</option><option value="elim"${fc.mode === 'elim' ? ' selected' : ''}>Knockout</option></select>
        <div id="af_fpoints">
          <label>Number of rounds</label>
          <input type="number" id="af_frounds" min="1" max="10" value="${fc.rounds || 3}" autocomplete="off">
          <label>After each round</label>
          <div class="row" style="gap:10px;align-items:center">
            <select id="af_fcutmode" style="flex:1"><option value="0"${!fc.cutTo ? ' selected' : ''}>Everyone continues</option><option value="1"${fc.cutTo ? ' selected' : ''}>Cut to the top \u2026</option></select>
            <input type="number" id="af_fcutto" min="2" max="64" value="${fc.cutTo || 8}" style="flex:0 0 90px;${fc.cutTo ? '' : 'display:none'}" autocomplete="off">
          </div>
          <label>After the last round</label>
          <div class="row" style="gap:10px;align-items:center">
            <select id="af_ffinalmode" style="flex:1"><option value="0"${!fc.finalSize ? ' selected' : ''}>Highest points is champion</option><option value="1"${fc.finalSize ? ' selected' : ''}>Top \u2026 play a final lobby</option></select>
            <input type="number" id="af_ffinalsize" min="2" max="16" value="${fc.finalSize || 4}" style="flex:0 0 90px;${fc.finalSize ? '' : 'display:none'}" autocomplete="off">
          </div>
        </div>
        <div id="af_felim" style="display:none">
          <label>Advancing per lobby</label>
          <select id="af_fadv">${[1,2,3,4].map(n => '<option value="' + n + '"' + (n === (fc.advance || 1) ? ' selected' : '') + '>' + (n === 1 ? 'Winner only' : 'Top ' + n) + '</option>').join('')}</select>
        </div>
      </div>
      <label>Seeding</label>
      <select id="af_seed"${dis}><option value="rating"${T.seeding === 'rating' ? ' selected' : ''}>By rating</option><option value="random"${T.seeding === 'random' ? ' selected' : ''}>Random</option></select>
      <label>Max teams / entrants (0 = unlimited)</label>
      <input type="number" id="af_max" min="0" max="128" value="${T.maxTeams || 0}" autocomplete="off">
      <label>Signups</label>
      <select id="af_signupMode">
        <option value="open"${(T.signupMode || 'open') === 'open' ? ' selected' : ''}>Open — anyone can sign up</option>
        <option value="request"${T.signupMode === 'request' ? ' selected' : ''}>Request only — organizer approves</option>
        <option value="invite"${T.signupMode === 'invite' ? ' selected' : ''}>Invite only</option>
      </select>
      <label style="display:block;margin-top:10px"><input type="checkbox" id="af_playerReporting"${T.playerReporting ? ' checked' : ''}> Allow players to submit scores <span class="muted small">(replay IDs + opponent confirmation)</span></label>
      <div style="margin-top:16px"><button class="btn amber" id="af_save">Save format</button></div>
    </div>`;
  }

  if (T.status === 'drafted' && T.competition === 'team' && (T.bracketType === 'single' || T.bracketType === 'double')) {
    const seeded = T.teams.slice().sort((a, b) => a.seed - b.seed);
    html += `<div class="panel section"><h2>Seeding</h2>
      <p class="muted small">Drag to reorder, or use the arrows. Seed 1 is the top seed. This determines the bracket \u2014 fixed once you start it.</p>
      <div style="margin:10px 0"><button class="btn ghost small" id="seedRandom">\ud83c\udfb2 Randomize</button>
      ${T.seeding === 'rating' ? '<button class="btn ghost small" id="seedByRating" style="margin-left:8px">Reset to rating order</button>' : ''}</div>
      <ol id="seedList" class="seedlist">
        ${seeded.map(tm => `<li class="seeditem" draggable="true" data-tid="${tm.id}">
          <span class="seednum"></span>
          <span class="seedname">${esc(tm.name)}</span>
          <span class="seedbtns"><button class="seedup" title="Move up">\u25b2</button><button class="seeddown" title="Move down">\u25bc</button></span>
        </li>`).join('')}
      </ol>
      <div style="margin-top:12px"><button class="btn amber" id="seedSave">Save seeding</button> <span class="muted small" id="seedDirty"></span></div>
    </div>`;
  }

  html += `<div class="panel section"><h2>Game setup</h2>
    <div class="row" style="justify-content:space-between;align-items:center">
      <label style="margin:0">Description</label>
      <span class="muted small">Paste a screenshot straight in, or <a href="#" id="aiDescImgBtn">insert an image</a>.</span>
    </div>
    ${mdToolbarHTML()}
    <textarea id="aiDesc" maxlength="20000" rows="8">${esc(T.description || '')}</textarea>
    <input type="file" id="aiDescImgFile" accept="image/*" style="display:none">
    <label style="margin-top:12px">Lobby options</label>
    ${mdToolbarHTML()}
    <textarea id="aiLobby" maxlength="20000" rows="6">${esc(T.lobbyOptions || '')}</textarea>
    <label style="margin-top:12px">Mods</label>
    ${mdToolbarHTML()}
    <textarea id="aiMods" maxlength="500" rows="2">${esc(T.mods || '')}</textarea>
    <div style="margin-top:14px"><button class="btn" id="aiSave">Save setup</button></div>
  </div>`;

  html += `<div class="panel section"><h2>Rewards</h2>
    <p class="muted small">Shown prominently on the Overview tab. Editable at any time.</p>
    <div class="row" style="justify-content:space-between;align-items:center">
      <label style="margin:0">Rewards</label>
      <span class="muted small">Paste a screenshot straight in (e.g. an avatar), or <a href="#" id="aiRwImgBtn">insert an image</a>.</span>
    </div>
    ${mdToolbarHTML()}
    <textarea id="aiRewards" maxlength="2000" rows="5" placeholder="e.g. 1st place: exclusive avatar + 500 credits...">${esc(T.rewards || '')}</textarea>
    <label style="margin-top:10px">Overall cash prize <span class="muted small">(shown as its own box at the top of Rewards)</span></label>
    <div class="prize-row">
      <select id="aiPrizeCur">
        <option value=""${!(T.prize && T.prize.currency) ? ' selected' : ''}>\u2014 none \u2014</option>
        <option value="USD"${(T.prize && T.prize.currency) === 'USD' ? ' selected' : ''}>USD $</option>
        <option value="EUR"${(T.prize && T.prize.currency) === 'EUR' ? ' selected' : ''}>EUR \u20ac</option>
        <option value="RUB"${(T.prize && T.prize.currency) === 'RUB' ? ' selected' : ''}>RUB \u20bd</option>
      </select>
      <input type="number" id="aiPrizeAmt" min="0" step="1" inputmode="numeric" placeholder="Amount" value="${(T.prize && T.prize.amount != null) ? T.prize.amount : ''}">
    </div>
    <input type="file" id="aiRwImgFile" accept="image/*" style="display:none">
    <div style="margin-top:14px"><button class="btn" id="aiRwSave">Save rewards</button></div>
  </div>`;

  html += `<div class="panel section"><h2>Sponsors</h2>
    <div class="row" style="justify-content:space-between;align-items:center">
      <p class="muted small" style="margin:0">Shown prominently on the Overview next to the rewards. Text, links, or images.</p>
      <span class="muted small">Paste a screenshot straight in, or <a href="#" id="aiSpImgBtn">insert an image</a>.</span>
    </div>
    ${mdToolbarHTML()}
    <textarea id="aiSponsors" maxlength="2000" rows="5" placeholder="e.g. Powered by [YourSponsor](https://sponsor.example) \u2014 thanks for the prize pool!">${esc(T.sponsors || '')}</textarea>
    <input type="file" id="aiSpImgFile" accept="image/*" style="display:none">
    <div style="margin-top:14px"><button class="btn" id="aiSpSave">Save sponsors</button></div>
  </div>`;

  html += `<div class="panel section"><h2>Livestreams</h2>
    <p class="muted small">Where this tournament is streamed \u2014 shown near the top of the Overview with clickable links. Add one row per stream; leave a row's link empty to drop it.</p>
    <div id="aiStreams">${((T.streams && T.streams.length) ? T.streams : [{ url: '', info: '' }]).map(st => `
      <div class="row stream-row" style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap">
        <input type="text" class="stUrl" placeholder="https://twitch.tv/..." maxlength="300" value="${esc(st.url || '')}" style="flex:2;min-width:220px" autocomplete="off">
        <input type="text" class="stInfo" placeholder="Info, e.g. Main stream (English), casted by X" maxlength="120" value="${esc(st.info || '')}" style="flex:2;min-width:220px" autocomplete="off">
      </div>`).join('')}</div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn ghost small" id="aiStAdd">+ Add another stream</button>
      <button class="btn" id="aiStSave">Save livestreams</button>
    </div></div>`;

  if ((T.chatMutes || []).length) {
    html += `<div class="panel section"><h2>Muted in chat <span class="h2-strong">(${T.chatMutes.length})</span></h2>
      <p class="muted small">Muted accounts can read chat but not post. Mute anyone from the controls on their messages in any chat room.</p>
      <div class="pick-rows">${T.chatMutes.map(mu => `<div class="pick-row on" style="cursor:default">
        <span class="pr-name">${esc(mu.name)} <span class="muted small">FAF id ${esc(mu.fafId)}</span></span>
        <button class="btn ghost small" data-unmute="${esc(mu.fafId)}">Unmute</button>
      </div>`).join('')}</div></div>`;
  }

  html += `<div class="panel section"><h2>Rating requirements</h2>
    <p class="muted small">Min/Max <strong>refuse</strong> self-signups outside the range. The <strong>rating cap</strong> is different: it doesn\u2019t refuse anyone \u2014 a player above it is treated as exactly the cap value (displayed and calculated as the cap), e.g. cap 2200 makes a 2400 count as 2200. Organizer adds, replaces, moves and invited players bypass the min/max refusal but are still capped. All editable at any time; changing the cap re-applies to everyone instantly.</p>
    <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px"><label>Min player rating</label><input type="number" id="aiMinR" min="0" max="4000" value="${T.minRating != null ? T.minRating : ''}" placeholder="off"></div>
      <div style="flex:1;min-width:140px"><label>Max player rating</label><input type="number" id="aiMaxR" min="0" max="4000" value="${T.maxRating != null ? T.maxRating : ''}" placeholder="off"></div>
      ${T.teamSize > 1 ? '<div style="flex:1;min-width:140px"><label>Max team rating (combined)</label><input type="number" id="aiMaxTR" min="0" max="30000" value="' + (T.maxTeamRating != null ? T.maxTeamRating : '') + '" placeholder="off"></div>' : ''}
      <div style="flex:1;min-width:140px"><label>Rating cap (clamp)</label><input type="number" id="aiCapR" min="0" max="4000" value="${T.ratingCap != null ? T.ratingCap : ''}" placeholder="off"></div>
    </div>
    <div style="margin-top:12px"><button class="btn" id="aiRatSave">Save rating limits</button></div>
    ${T.ratingType && T.ratingType !== 'none' ? `<div style="border-top:1px solid var(--line-solid);margin-top:16px;padding-top:14px">
      <label>Rating source date <span class="muted small">(FAF ratings are pulled as of this day; blank = whenever the player signs up)</span></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="date" id="aiRatingDate" value="${T.ratingDate ? new Date(T.ratingDate).toISOString().slice(0, 10) : ''}" style="flex:1;min-width:180px">
        <button class="btn" id="aiRatingDateSave">Save rating date</button>
      </div>
      <p class="muted small" style="margin-top:6px">Currently: <strong>${T.ratingDate ? new Date(T.ratingDate).toLocaleDateString() : 'taken at signup time'}</strong>. Changing this affects ratings pulled from now on; it doesn't retroactively re-pull players already signed up.</p>
    </div>` : ''}
  </div>`;

  if (T.status !== 'finished' && T.competition === 'team') {
    const v = T.veto || { enabled: false, mode: 'upfront' };
    const pools = T.mapPools || [];
    const ready = pools.filter(p => (p.sequence || []).length && (p.sequence || []).length === (p.mapIds || []).length - 1);
    html += `<div class="panel section"><h2>Map vetoes</h2>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="vtEnabled" style="width:auto"${v.enabled ? ' checked' : ''}> Enable map vetoes</label>
      <div id="vtCfg" style="${v.enabled ? '' : 'display:none;'}margin-top:12px">
        <p class="muted small">Each match's captains ban/pick from the pool assigned to their match, following that pool's own ban/pick order. Build pools, their orders, and their round assignments on the <strong>Maps</strong> tab.</p>
        ${pools.length === 0
          ? '<p class="warn small">No map pools yet — create one on the Maps tab or no vetoes will run.</p>'
          : '<div class="pool-status">' + pools.map(p => {
              const steps = (p.sequence || []).length, need = (p.mapIds || []).length - 1;
              const picks = (p.sequence || []).filter(x => x.action === 'pick').length;
              const bo = p.bo || 1;
              const ok = steps > 0 && steps === need && picks === bo - 1;
              return '<div class="pool-status-row">' + (ok ? '<span class="idbadge verified">ready</span>' : '<span class="idbadge late">needs setup</span>') +
                ' <strong>' + esc(p.name) + '</strong> <span class="muted small">' + (p.mapIds || []).length + ' maps · ' +
                (ok ? 'Bo' + bo + ' matches' : (steps === 0 ? 'no ban/pick order set' : 'order needs ' + need + ' steps / ' + (bo - 1) + ' picks')) + '</span></div>';
            }).join('') + '</div>'}
        <label style="margin-top:14px">Who is Team A?</label>
        <select id="vtAb" style="max-width:420px">
          <option value="lowerA"${(v.abMode || 'lowerA') === 'lowerA' ? ' selected' : ''}>Lower rated is Team A (acts first)</option>
          <option value="lowerB"${v.abMode === 'lowerB' ? ' selected' : ''}>Lower rated is Team B (higher rated acts first)</option>
          <option value="random"${v.abMode === 'random' ? ' selected' : ''}>Random per match</option>
          <option value="manual"${v.abMode === 'manual' ? ' selected' : ''}>I set it myself for every match</option>
        </select>
        <div class="muted small" style="margin-top:6px" id="vtAbNote"></div>

        <label style="margin-top:14px">When is the veto done?</label>
        <select id="vtMode" style="max-width:420px">
          <option value="upfront"${v.mode !== 'continuous' ? ' selected' : ''}>All upfront — captains complete the whole veto before game 1</option>
          <option value="continuous"${v.mode === 'continuous' ? ' selected' : ''}>Continuous — reveal steps as games are played</option>
        </select>
        <div class="muted small" style="margin-top:8px">Whatever the rule, you can still override A/B on any match from the Vetoes tab before it starts.</div>
      </div>
      <div style="margin-top:12px"><button class="btn amber" id="vtSave">Save vetoes</button></div>
    </div>`;
  }

  // Faction vetoes: 1v1 only, since each side is one player choosing their own faction.
  if (T.status !== 'finished' && T.competition === 'team' && T.teamSize === 1) {
    const fv = T.fveto || { enabled: 0, bans: 1, picks: 2 };
    html += `<div class="panel section"><h2>Faction vetoes</h2>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="fvEnabled" style="width:auto"${fv.enabled ? ' checked' : ''}> Enable faction vetoes</label>
      <div id="fvCfg" style="${fv.enabled ? '' : 'display:none;'}margin-top:12px">
        <p class="muted small">Runs per game of a series, in parallel with the map veto and independently of it. Each player bans factions (denying them to their opponent), then picks factions in order of preference. <strong>Nobody sees anyone else's choices \u2014 not the opponent, not you.</strong> You can see who still owes choices. Once both are done the result is shown to everyone.</p>
        <label style="margin-top:12px">Bans each</label>
        <select id="fvBans" style="max-width:200px">
          <option value="1"${fv.bans === 1 ? ' selected' : ''}>1 ban</option>
          <option value="2"${fv.bans === 2 ? ' selected' : ''}>2 bans</option>
        </select>
        <label style="margin-top:12px">Picks each</label>
        <select id="fvPicks" style="max-width:200px"></select>
        <div class="muted small" style="margin-top:6px" id="fvNote"></div>
      </div>
      <div style="margin-top:12px"><button class="btn amber" id="fvSave">Save faction vetoes</button></div>
    </div>`;
  }

  html += `<div class="panel section"><h2>Organizer notes</h2>
    <ul class="muted small">
      <li>Substitutions: Players tab \u2192 "Replace" next to the player. The sub takes over their exact spot (team, seed, results). Subs come from unteamed signups \u2014 share the late-signup link from this tab if you need someone new mid-tournament.</li>
      <li>Maps: group maps into pools on the Maps tab, then assign a pool per round via the "change" link in each round's MAP POOL header on the Bracket tab (or per match from the Vetoes tab).</li>
      <li>Schedule changes: post them on the News tab with "highlight" ticked \u2014 players get an unread badge and see the latest update on the Overview.</li>
      <li>Running scores: reporting 1-0 in a Bo3 keeps the match LIVE; it completes when a team reaches the required wins.</li>
      <li>Corrections: you can fix a finished match as long as the follow-up match hasn't started.</li>
      <li>Data lives in the container volume \u2014 deleting the volume deletes tournaments.</li>
    </ul></div>`;

  if ((T.descImages || []).length) {
    const inlineRef = (T.description || '') + ' ' + (T.rewards || '');
    html += `<div class="panel section"><h2>Attached images <span class="muted small">(${(T.descImages || []).length}/10)</span></h2>
    <p class="muted small" style="margin:6px 0 10px">New images are added by pasting them straight into the Description or Rewards text above. Images referenced there are marked "in use"; unreferenced ones show in a gallery under the briefing. Removing an image deletes its file.</p>
    <div class="desc-gallery">${(T.descImages || []).map(f => { const used = inlineRef.indexOf('/desc-images/' + encodeURIComponent(f)) >= 0 || inlineRef.indexOf('/desc-images/' + f) >= 0; return `<div class="desc-thumb"><img src="/desc-images/${encodeURIComponent(f)}" alt="">${used ? '<div class="mono small" style="color:var(--green);text-align:center">in use</div>' : ''}<button class="btn danger small" data-descdel="${esc(f)}">Remove</button></div>`; }).join('')}</div></div>`;
  }

  if (siteAdmin()) {
    html += `<div class="panel section"><h2>Category <span class="muted small">(site admin only)</span></h2>
      <p class="muted small">Organizers pick this once at creation; only site admins can change it afterwards.</p>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="catbox ${T.category === 'official' ? 'official' : 'community'}">${T.category === 'official' ? 'OFFICIAL' : 'COMMUNITY'}</span>
        <button class="btn ghost small" id="saCatSwap">Change to ${T.category === 'official' ? 'COMMUNITY' : 'OFFICIAL'}</button>
      </div></div>`;
  }

  html += `<div class="panel section" style="border-color:var(--danger,#e5484d)"><h2>Archive / Abandon</h2>
    <p class="muted small" style="margin:6px 0 10px"><strong>Archive</strong> hides this tournament from everyone (reversible by a site admin). <strong>Abandoned</strong> keeps it visible under Completed with a red ABANDONED badge — the honest label when it never actually happened, e.g. too few signups. Abandoning is reversible here.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn danger" id="archiveBtn">Archive tournament</button>
      ${T.abandoned
        ? '<button class="btn ghost" id="abandonBtn" data-undo="1">Undo abandoned</button>'
        : '<button class="btn danger" id="abandonBtn">Mark as abandoned</button>'}
    </div></div>`;

  el.innerHTML = html;
  const tdSave = document.getElementById('td_save');
  if (tdSave) tdSave.onclick = async () => {
    try {
      const info = { admin: adminToken() };
      const nm = document.getElementById('td_name'); if (nm && nm.value.trim()) info.name = nm.value.trim();
      const dd = document.getElementById('td_date');
      if (dd) {
        info.eventDate = combineDateTimeUTC(dd, document.getElementById('td_time'));
        info.signupOpensAt = combineDateTimeUTC(document.getElementById('td_sudate'), document.getElementById('td_sutime'));
        info.signupClosesAt = combineDateTimeUTC(document.getElementById('td_scdate'), document.getElementById('td_sctime'));
        info.checkInDeadline = combineDateTimeUTC(document.getElementById('td_cidate'), document.getElementById('td_citime'));
        info.minTeams = document.getElementById('td_min').value;
        info.maxTeams = document.getElementById('td_max').value;
      }
      await api('/api/t/' + T.id + '/edit_info', info);
      toast('Details saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const claimSelf = document.getElementById('orgClaimSelf');
  if (claimSelf) claimSelf.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/claim_organizer', { adminToken: secrets.adminToken });
      toast('You are now listed as an organizer');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  // qualifier panel: reveal toggle + searchable picker limited to tournaments the viewer organizes
  {
    const enable = document.getElementById('qlEnable');
    const body = document.getElementById('qlBody');
    if (enable && body) enable.onchange = () => {
      _qlPanelOpen = enable.checked;
      body.style.display = enable.checked ? '' : 'none';
    };

    const search = document.getElementById('qlSearch');
    const opts = document.getElementById('qlOpts');
    if (search && opts) {
      let all = [], chosen = null;
      const linked = new Set((T.qualifiers || []).map(q => q.tournamentId));
      const render = (q) => {
        const term = (q || '').toLowerCase();
        const hits = all.filter(t2 => !term || t2.name.toLowerCase().includes(term)).slice(0, 12);
        if (!hits.length) {
          opts.innerHTML = '<div class="ql-opt muted">' + (all.length ? 'No match.' : 'You don\u2019t organize any other tournaments yet.') + '</div>';
        } else {
          opts.innerHTML = hits.map(t2 =>
            `<div class="ql-opt" data-qlpick="${esc(t2.id)}">${esc(t2.name)} <span class="muted small">${esc(t2.status === 'finished' ? 'finished' : t2.status)}</span></div>`).join('');
          opts.querySelectorAll('[data-qlpick]').forEach(d => d.onmousedown = (ev) => {
            ev.preventDefault();
            chosen = all.find(x => x.id === d.dataset.qlpick) || null;
            search.value = chosen ? chosen.name : '';
            opts.style.display = 'none';
          });
        }
        opts.style.display = '';
      };
      fetch('/api/my_tournaments').then(r => r.json()).then(d => {
        all = (d.tournaments || []).filter(t2 => t2.id !== T.id && !linked.has(t2.id));
      }).catch(() => {});
      search.addEventListener('focus', () => render(search.value));
      search.addEventListener('input', () => { chosen = null; render(search.value); });
      search.addEventListener('blur', () => setTimeout(() => { opts.style.display = 'none'; }, 150));

      const add = document.getElementById('qlAdd');
      if (add) add.onclick = async () => {
        // allow an exact typed name as well as a clicked suggestion
        if (!chosen) chosen = all.find(x => x.name.toLowerCase() === (search.value || '').trim().toLowerCase()) || null;
        if (!chosen) return toast('Pick one of your tournaments from the list', true);
        try {
          await api('/api/t/' + T.id + '/qualifier_add', {
            tournamentId: chosen.id,
            ruleType: document.getElementById('qlType').value,
            n: document.getElementById('qlN').value,
            admin: adminToken()
          });
          _qlPanelOpen = true;
          toast('Qualifier added'); await refresh();
        } catch (e) { toast(e.message, true); }
      };
    }
    el.querySelectorAll('[data-qlrm]').forEach(b => b.onclick = async () => {
      if (!confirm('Remove this qualifier link? Invites already sent are kept.')) return;
      try { await api('/api/t/' + T.id + '/qualifier_remove', { id: b.dataset.qlrm, admin: adminToken() }); toast('Removed'); await refresh(); }
      catch (e) { toast(e.message, true); }
    });
  }

  // series selector: fill from the series list, then save on demand
  const srSel = document.getElementById('tSeriesSel');
  if (srSel) {
    fetch('/api/series').then(r => r.json()).then(d => {
      for (const s2 of (d.series || [])) {
        const o = document.createElement('option');
        o.value = s2.id; o.textContent = s2.name + ' (' + s2.editions + ')';
        if (T.seriesId === s2.id) o.selected = true;
        srSel.appendChild(o);
      }
    }).catch(() => {});
    const svBtn = document.getElementById('tSeriesSave');
    if (svBtn) svBtn.onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/set_series', { seriesId: srSel.value, admin: adminToken() });
        toast(srSel.value ? 'Series set' : 'Removed from series');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }
  el.querySelectorAll('[data-serieslink]').forEach(a => a.onclick = (e) => { e.preventDefault(); nav(a.getAttribute('href')); });

  const orgAddBox = document.getElementById('orgAdd');
  if (orgAddBox) adminLookupBox(orgAddBox, (found, result) => {
    result.innerHTML = `Found <strong>${esc(found.name)}</strong> (id ${esc(found.fafId)}) <button class="btn primary small" id="orgAddGo">Make organizer</button>`;
    result.querySelector('#orgAddGo').onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/add_organizer', { fafId: found.fafId, name: found.name, admin: adminToken() });
        toast('Organizer added'); await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }, { tournamentId: T.id });
  const casterAddBox = document.getElementById('casterAdd');
  if (casterAddBox) adminLookupBox(casterAddBox, (found, result) => {
    result.innerHTML = `Found <strong>${esc(found.name)}</strong> (id ${esc(found.fafId)}) <button class="btn primary small" id="casterAddGo">Make caster</button>`;
    result.querySelector('#casterAddGo').onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/add_caster', { fafId: found.fafId, name: found.name, admin: adminToken() });
        toast('Caster added'); await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }, { tournamentId: T.id });
  el.querySelectorAll('[data-casterdel]').forEach(b => b.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/remove_caster', { fafId: b.dataset.casterdel, admin: adminToken() });
      toast('Caster removed'); await refresh();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-orgvis]').forEach(b => b.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/organizer_visibility', { fafId: b.dataset.orgvis, hidden: b.dataset.hidden === '1' ? 0 : 1, admin: adminToken() });
      toast(b.dataset.hidden === '1' ? 'Now visible to players' : 'Hidden from players');
      await refresh();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-orgdel]').forEach(b => b.onclick = async () => {
    const last = (T.organizers || []).length <= 1;
    if (!confirm('Remove organizer rights from this account?' + (last ? '\n\nThis is the LAST organizer — afterwards only site admins can manage this tournament.' : ''))) return;
    try {
      await api('/api/t/' + T.id + '/remove_organizer', { fafId: b.dataset.orgdel, admin: siteAdmin() });
      toast('Organizer removed');
      await refresh();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied'));
  });

  const abandonBtn = document.getElementById('abandonBtn');
  if (abandonBtn) abandonBtn.onclick = async () => {
    const undo = abandonBtn.dataset.undo === '1';
    if (!confirm(undo
      ? 'Remove the ABANDONED mark from this tournament?'
      : 'Are you sure you want to mark this tournament as ABANDONED?\n\nIt stays visible under Completed with a red ABANDONED badge instead of "finished". You can undo this later.')) return;
    try {
      await api('/api/t/' + T.id + '/abandon', { undo: undo ? 1 : 0, admin: adminToken() });
      toast(undo ? 'Abandoned mark removed' : 'Marked as abandoned');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const archiveBtn = document.getElementById('archiveBtn');
  if (archiveBtn) archiveBtn.onclick = async () => {
    if (!confirm('Archive this tournament? It will be hidden from everyone. A site admin can restore it later.')) return;
    try { await api('/api/t/' + T.id + '/delete', { admin: adminToken() }); toast('Archived'); location.href = '/'; }
    catch (e) { toast(e.message, true); }
  };

  // paste-to-upload for description and rewards (images land in the shared attached set)
  const descUploader = async (dataUrl) => {
    const d = await api('/api/t/' + T.id + '/add_desc_image', { image: dataUrl, admin: adminToken() });
    return d;
  };
  const aiDescTa = document.getElementById('aiDesc');
  if (aiDescTa) { wireImagePaste(aiDescTa, descUploader, document.getElementById('aiDescImgBtn'), document.getElementById('aiDescImgFile')); wireMdToolbar(aiDescTa.previousElementSibling, aiDescTa); }
  const aiLobbyTa = document.getElementById('aiLobby');
  if (aiLobbyTa) { wireImagePaste(aiLobbyTa, descUploader, null, null); wireMdToolbar(aiLobbyTa.previousElementSibling, aiLobbyTa); }
  const aiModsTa = document.getElementById('aiMods');
  if (aiModsTa) wireMdToolbar(aiModsTa.previousElementSibling, aiModsTa);
  const aiRwTa = document.getElementById('aiRewards');
  if (aiRwTa) { wireImagePaste(aiRwTa, descUploader, document.getElementById('aiRwImgBtn'), document.getElementById('aiRwImgFile')); wireMdToolbar(aiRwTa.previousElementSibling, aiRwTa); }
  const aiSpTa = document.getElementById('aiSponsors');
  if (aiSpTa) { wireImagePaste(aiSpTa, descUploader, document.getElementById('aiSpImgBtn'), document.getElementById('aiSpImgFile')); wireMdToolbar(aiSpTa.previousElementSibling, aiSpTa); }
  const stAdd = document.getElementById('aiStAdd');
  if (stAdd) stAdd.onclick = () => {
    const wrap = document.getElementById('aiStreams');
    const div = document.createElement('div');
    div.className = 'row stream-row';
    div.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap';
    div.innerHTML = '<input type="text" class="stUrl" placeholder="https://twitch.tv/..." maxlength="300" style="flex:2;min-width:220px" autocomplete="off">'
      + '<input type="text" class="stInfo" placeholder="Info, e.g. Main stream (English), casted by X" maxlength="120" style="flex:2;min-width:220px" autocomplete="off">';
    wrap.appendChild(div);
  };
  const stSave = document.getElementById('aiStSave');
  if (stSave) stSave.onclick = async () => {
    const rows = Array.from(el.querySelectorAll('.stream-row'));
    const streams = rows.map(r => ({ url: r.querySelector('.stUrl').value.trim(), info: r.querySelector('.stInfo').value.trim() })).filter(x => x.url);
    const badRow = streams.find(x => !/^https?:\/\//.test(x.url));
    if (badRow) return toast('Links must start with http:// or https://', true);
    try {
      await api('/api/t/' + T.id + '/edit_info', { streams, admin: adminToken() });
      toast('Livestreams saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const catSwap = document.getElementById('saCatSwap');
  if (catSwap) catSwap.onclick = async () => {
    const to = T.category === 'official' ? 'community' : 'official';
    if (!confirm('Change this tournament\u2019s category to ' + to.toUpperCase() + '?')) return;
    try {
      await api('/api/t/' + T.id + '/set_category', { category: to, admin: siteAdmin() });
      toast('Category changed');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  el.querySelectorAll('[data-unmute]').forEach(b => b.onclick = async () => {
    try { await api('/api/t/' + T.id + '/chat_mute', { fafId: b.dataset.unmute, unmute: 1, admin: adminToken() }); toast('Unmuted'); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
  const ratSave = document.getElementById('aiRatSave');
  if (ratSave) ratSave.onclick = async () => {
    try {
      const body = { minRating: document.getElementById('aiMinR').value, maxRating: document.getElementById('aiMaxR').value, ratingCap: document.getElementById('aiCapR').value, admin: adminToken() };
      const tr = document.getElementById('aiMaxTR');
      if (tr) body.maxTeamRating = tr.value;
      await api('/api/t/' + T.id + '/edit_info', body);
      toast('Rating limits saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const ratingDateSave = document.getElementById('aiRatingDateSave');
  if (ratingDateSave) ratingDateSave.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/edit_info', { ratingDate: document.getElementById('aiRatingDate').value || null, admin: adminToken() });
      toast('Rating date saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const rwSave = document.getElementById('aiRwSave');
  if (rwSave) rwSave.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/edit_info', {
        rewards: aiRwTa.value,
        prizeCurrency: (document.getElementById('aiPrizeCur') || {}).value || '',
        prizeAmount: (document.getElementById('aiPrizeAmt') || {}).value || '',
        admin: adminToken()
      });
      toast('Rewards saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const spSave = document.getElementById('aiSpSave');
  if (spSave) spSave.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/edit_info', { sponsors: aiSpTa.value, admin: adminToken() });
      toast('Sponsors saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  el.querySelectorAll('[data-descdel]').forEach(b => b.onclick = async () => {
    try { await api('/api/t/' + T.id + '/remove_desc_image', { file: b.dataset.descdel, admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  });

  // ---- veto config (enable + mode; ban/pick orders live on each pool in the Maps tab) ----
  const vtEnabled = document.getElementById('vtEnabled');
  if (vtEnabled) {
    vtEnabled.onchange = () => { document.getElementById('vtCfg').style.display = vtEnabled.checked ? 'block' : 'none'; };
    const vtAb = document.getElementById('vtAb');
    const abNote = () => {
      const notes = {
        lowerA: 'The lower rated captain is Team A and takes the first step. Rating comes from the captain, not the team average.',
        lowerB: 'The lower rated captain is Team B, so the higher rated captain takes the first step. Rating comes from the captain, not the team average.',
        random: 'A coin flip per match, decided when the match is ready.',
        manual: 'Nobody can start their veto until you set Team A on that match (Vetoes tab). Use this when you want full control.'
      };
      document.getElementById('vtAbNote').textContent = notes[vtAb.value] || '';
    };
    if (vtAb) { vtAb.onchange = abNote; abNote(); }
    document.getElementById('vtSave').onclick = async () => {
      const enabled = vtEnabled.checked;
      const mode = document.getElementById('vtMode').value;
      const abMode = vtAb ? vtAb.value : 'lowerA';
      if (enabled) {
        const pools = T.mapPools || [];
        const ready = pools.filter(p => (p.sequence || []).length && (p.sequence || []).length === (p.mapIds || []).length - 1);
        if (ready.length === 0) return toast('No pool has a valid ban/pick order yet — set one up on the Maps tab first', true);
      }
      try {
        await api('/api/t/' + T.id + '/edit_info', { veto: { enabled, mode, abMode }, admin: adminToken() });
        await refresh();
        toast('Vetoes saved');
      } catch (e) { toast(e.message, true); }
    };
  }

  // ---- faction vetoes ----
  const fvEnabled = document.getElementById('fvEnabled');
  if (fvEnabled) {
    const cfg = document.getElementById('fvCfg');
    const bansSel = document.getElementById('fvBans');
    const picksSel = document.getElementById('fvPicks');
    const note = document.getElementById('fvNote');
    const cur = T.fveto || { bans: 1, picks: 2 };
    // Picks must exceed bans or an opponent could ban every faction you nominated, leaving the
    // game unresolvable. The options offered adapt so an invalid pair can't be chosen at all.
    const syncPicks = () => {
      const b = parseInt(bansSel.value, 10);
      const min = b + 1;
      const keep = parseInt(picksSel.value, 10) || cur.picks || min;
      picksSel.innerHTML = '';
      for (let n = min; n <= 3; n++) {
        const o = document.createElement('option');
        o.value = String(n); o.textContent = n + ' pick' + (n === 1 ? '' : 's');
        if (n === keep) o.selected = true;
        picksSel.appendChild(o);
      }
      if (!picksSel.value) picksSel.selectedIndex = 0;
      note.textContent = 'With ' + b + ' ban' + (b === 1 ? '' : 's') + ' each, at least ' + min +
        ' picks are needed so your opponent can never ban all of them. There are 4 factions.';
    };
    fvEnabled.onchange = () => { cfg.style.display = fvEnabled.checked ? '' : 'none'; };
    bansSel.onchange = syncPicks;
    syncPicks();
    document.getElementById('fvSave').onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/fveto_config', {
          enabled: fvEnabled.checked ? 1 : 0,
          bans: parseInt(bansSel.value, 10),
          picks: parseInt(picksSel.value, 10),
          admin: adminToken()
        });
        await refresh();
        toast('Faction vetoes saved');
      } catch (e) { toast(e.message, true); }
    };
  }

  // ---- seeding editor ----
  const seedList = document.getElementById('seedList');
  if (seedList) {
    const renumber = () => {
      let i = 1;
      seedList.querySelectorAll('.seeditem').forEach(li => { li.querySelector('.seednum').textContent = i++; });
      const sd = document.getElementById('seedDirty'); if (sd) sd.textContent = 'unsaved changes';
    };
    renumber();
    const sd0 = document.getElementById('seedDirty'); if (sd0) sd0.textContent = '';

    // arrow buttons
    seedList.querySelectorAll('.seedup').forEach(b => b.onclick = e => {
      const li = e.target.closest('.seeditem'); const prev = li.previousElementSibling;
      if (prev) { seedList.insertBefore(li, prev); renumber(); }
    });
    seedList.querySelectorAll('.seeddown').forEach(b => b.onclick = e => {
      const li = e.target.closest('.seeditem'); const next = li.nextElementSibling;
      if (next) { seedList.insertBefore(next, li); renumber(); }
    });

    // drag and drop
    let dragEl = null;
    seedList.querySelectorAll('.seeditem').forEach(li => {
      li.addEventListener('dragstart', () => { dragEl = li; li.classList.add('dragging'); });
      li.addEventListener('dragend', () => { if (dragEl) dragEl.classList.remove('dragging'); dragEl = null; renumber(); });
    });
    seedList.addEventListener('dragover', e => {
      e.preventDefault();
      const after = [...seedList.querySelectorAll('.seeditem:not(.dragging)')].reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = e.clientY - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset, el: child };
        return closest;
      }, { offset: -Infinity, el: null }).el;
      if (!dragEl) return;
      if (after == null) seedList.appendChild(dragEl);
      else seedList.insertBefore(dragEl, after);
    });

    const saveOrder = async (order, randomize) => {
      try {
        await api('/api/t/' + T.id + '/reseed', randomize ? { randomize: 1, admin: adminToken() } : { order, admin: adminToken() });
        await refresh();
        toast('Seeding saved');
      } catch (e) { toast(e.message, true); }
    };
    document.getElementById('seedSave').onclick = () => {
      const order = [...seedList.querySelectorAll('.seeditem')].map(li => li.dataset.tid);
      saveOrder(order, false);
    };
    const rnd = document.getElementById('seedRandom');
    if (rnd) rnd.onclick = () => saveOrder(null, true);
    const byr = document.getElementById('seedByRating');
    if (byr) byr.onclick = async () => {
      // reset: order teams by their players' avg rating (desc)
      const withR = T.teams.map(tm => ({ id: tm.id, r: tm.playerIds.reduce((s, pid) => { const p = T.players.find(x => x.id === pid); return s + (p && p.rating || 0); }, 0) }));
      withR.sort((a, b) => b.r - a.r);
      saveOrder(withR.map(x => x.id), false);
    };
  }

  const afComp = document.getElementById('af_comp');
  if (afComp) {
    const g = id => document.getElementById(id);
    const syncPm = () => {
      const es = parseInt(g('af_fsize').value, 10);
      const maxL = Math.max(2, Math.floor(16 / es));
      g('af_pmLabel').textContent = (es === 1 ? 'Players' : 'Teams') + ' per FFA lobby';
      const cur = parseInt(g('af_pm').value, 10) || (T.ffaCfg && T.ffaCfg.perMatch) || 6;
      g('af_pm').innerHTML = '';
      for (let n = 2; n <= maxL; n++) {
        const players = es === 1 ? '' : ' (' + (n * es) + ' players)';
        g('af_pm').innerHTML += '<option value="' + n + '"' + (n === Math.min(cur, maxL) ? ' selected' : '') + '>' + n + players + '</option>';
      }
    };
    const sync = () => {
      const isFfa = afComp.value === 'ffa';
      g('af_team').style.display = isFfa ? 'none' : '';
      g('af_ffa').style.display = isFfa ? '' : 'none';
      g('af_formWrap').style.display = g('af_size').value === '1' ? 'none' : '';
      g('af_orderWrap').style.display = (g('af_form').value === 'draft' && g('af_size').value !== '1') ? '' : 'none';
      const bt = g('af_bt').value;
      const perRound = g('af_perRound') && g('af_perRound').checked;
      // the per-round toggle only applies to single/double elim
      if (g('af_perRoundWrap')) g('af_perRoundWrap').style.display = (isFfa || bt === 'swiss') ? 'none' : 'flex';
      if (g('af_perRoundNote')) g('af_perRoundNote').style.display = (!isFfa && bt !== 'swiss' && perRound) ? 'block' : 'none';
      g('af_pSingle').style.display = (bt === 'single' && !perRound) ? '' : 'none';
      g('af_pDouble').style.display = (bt === 'double' && !perRound) ? '' : 'none';
      g('af_pSwiss').style.display = bt === 'swiss' ? '' : 'none';
      g('af_fpoints').style.display = g('af_fmode').value === 'points' ? '' : 'none';
      g('af_felim').style.display = g('af_fmode').value === 'elim' ? '' : 'none';
      g('af_fcutto').style.display = g('af_fcutmode').value === '1' ? '' : 'none';
      g('af_ffinalsize').style.display = g('af_ffinalmode').value === '1' ? '' : 'none';
      syncPm();
    };
    for (const id of ['af_comp', 'af_size', 'af_form', 'af_bt', 'af_fsize', 'af_fmode', 'af_fcutmode', 'af_ffinalmode', 'af_perRound']) { const e = g(id); if (e) e.onchange = sync; }
    sync();

    g('af_save').onclick = async () => {
      const isFfa = afComp.value === 'ffa';
      const body = { admin: adminToken(), maxTeams: g('af_max').value,
        signupMode: g('af_signupMode').value, playerReporting: g('af_playerReporting').checked ? 1 : 0 };
      if (T.status === 'signup') {
        body.competition = afComp.value;
        body.teamSize = isFfa ? g('af_fsize').value : g('af_size').value;
        body.formation = g('af_form').value;
        body.draftOrder = g('af_order').value;
        body.seeding = g('af_seed').value;
      }
      if (!isFfa) {
        body.bracketType = g('af_bt').value;
        body.perRoundBo = (g('af_perRound') && g('af_perRound').checked) ? 1 : 0;
        if (g('af_bt').value === 'single') body.plan = { early: g('af_early').value, semi: g('af_semi').value, final: g('af_final').value };
        else if (g('af_bt').value === 'double') body.plan = { wb: g('af_wb').value, wbFinal: g('af_wbf').value, lb: g('af_lb').value, lbFinal: g('af_lbf').value, gf: g('af_gf').value, lbHandicap: g('af_hcap').checked };
        else body.plan = { bo: g('af_swbo').value, final: g('af_swfinal').checked, finalBo: g('af_swfbo').value, fast: g('af_swfast').checked };
      } else {
        body.perMatch = g('af_pm').value;
        body.mode = g('af_fmode').value;
        body.rounds = g('af_frounds').value;
        body.cutTo = g('af_fcutmode').value === '1' ? g('af_fcutto').value : 0;
        body.finalSize = g('af_ffinalmode').value === '1' ? g('af_ffinalsize').value : 0;
        body.advance = g('af_fadv').value;
      }
      try {
        await api('/api/t/' + T.id + '/edit_format', body);
        toast('Format saved');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }
  document.getElementById('aiSave').onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/edit_info', {
        description: document.getElementById('aiDesc').value,
        lobbyOptions: document.getElementById('aiLobby').value,
        mods: document.getElementById('aiMods').value,
        admin: adminToken()
      });
      toast('Setup saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
}

// ---------- per-tournament activity log (organizers + site admin only) ----------

function drawTlog(el) {
  if (!viewerIsOrganizer()) {
    el.innerHTML = '<div class="panel section"><div class="empty">Organizers only.</div></div>';
    return;
  }
  const rows = T.tlog || [];
  let html = `<div class="panel section"><h2>Activity log <span class="h2-strong">(${rows.length})</span></h2>
    <p class="muted small">Everything that happens in this tournament, newest first. Visible to organizers and site admins only. The last 1000 entries are kept; the latest 300 are shown here.</p>`;
  if (!rows.length) {
    html += '<div class="empty">Nothing logged yet.</div>';
  } else {
    html += '<table><thead><tr><th style="width:150px">When</th><th style="width:160px">Who</th><th>What</th></tr></thead><tbody>' +
      rows.map(r => `<tr><td class="mono small muted" style="white-space:nowrap">${esc(fmtDateTime(new Date(r.at).toISOString()))}</td><td>${esc(r.by || '')}</td><td class="small" style="overflow-wrap:anywhere">${esc(r.text || '')}</td></tr>`).join('') +
      '</tbody></table>';
  }
  html += '</div>';
  el.innerHTML = html;
}

// ---------- chat ----------
// A lightweight polling chat that runs independently of the main tournament poll so
// messages arrive quickly. One active room at a time; its own timer, torn down on close.
let _srOfficialOnly = false;   // series index: show only official series
let _qlPanelOpen = false;   // Qualifiers controls revealed on the Admin tab (per session)
let _chatRoom = null;
let _chatActiveRoom = null;
let _chatCompletedOpen = false;   // completed-match chats collapsed by default
let _chatSince = 0;
// Drop a room's unread marker from the cached view and repaint just the affected badges.
function clearUnreadFor(room) {
  if (!T || !T.unreadByRoom) return;
  const had = T.unreadByRoom[room] || 0;
  if (!had) return;
  delete T.unreadByRoom[room];
  T.myUnreadCount = Math.max(0, (T.myUnreadCount || 0) - had);
  // room button in the list
  const btn = document.querySelector('.chat-room[data-room="' + (window.CSS && CSS.escape ? CSS.escape(room) : room) + '"] .unread-dot');
  if (btn) btn.remove();
  // the CHAT tab's quiet badge
  const tabBtn = document.querySelector('.tab[data-tab="chat"] .tab-badge.quiet');
  if (tabBtn) {
    if (T.myUnreadCount > 0) tabBtn.textContent = T.myUnreadCount > 9 ? '9+' : T.myUnreadCount;
    else tabBtn.remove();
  }
}

let _chatTimer = null;
let _chatMsgs = [];
let _chatReplyTo = null;   // id of the message the composer is replying to, or null

let _chatPollNow = null;
function stopChatPoll() { if (_chatTimer) { clearInterval(_chatTimer); _chatTimer = null; } _chatPollNow = null; }

async function chatRooms() {
  const tok = viewToken();
  const r = await api('/api/t/' + T.id + '/chat_rooms' + (tok ? '?token=' + encodeURIComponent(tok) : ''));
  return r;
}

// Escape text, then visually highlight @mentions (word-initial @ followed by a name run).
// Purely cosmetic — matches loosely so "@Deli" or "@deli7961" both light up.
function highlightMentions(text) {
  const safe = esc(text || '');
  return safe.replace(/(^|\s)@([^\s@]{1,40})/g, (whole, pre, name) => pre + '<span class="chat-ping">@' + name + '</span>');
}

function renderChatMessages(container) {
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
  // Timestamps used to be raw browser-local hours, which ignored the viewer's chosen time zone
  // and gave no clue what DAY a message was from. Now: a divider whenever the day changes, and
  // the full date/time on hover, both honouring the viewer's tz and format settings.
  let lastDay = '';
  container.innerHTML = _chatMsgs.map(m => {
    const iso = new Date(m.at).toISOString();
    const time = fmtTimePart(new Date(m.at), resolvedTZ());
    const full = fmtDateTime(iso);
    const day = fmtDatePart(new Date(m.at), resolvedTZ());
    let divider = '';
    if (day !== lastDay) { divider = `<div class="chat-day"><span>${esc(day)}</span></div>`; lastDay = day; }
    if (m.sys) return divider + `<div class="chat-sys">\u{1F3B2} ${esc(m.text)} <span class="chat-time" title="${esc(full)}">${esc(time)}</span></div>`;
    const org = viewerIsOrganizer();
    // The quoted parent is a snapshot taken when the reply was posted, so it still reads
    // correctly if the original was deleted or has scrolled out of the retained history.
    const quote = m.replyTo ? `<div class="chat-quote" data-jump="${esc(m.replyTo.id)}" title="Jump to the original">
      <span class="cq-who">${esc(m.replyTo.who)}</span><span class="cq-text">${esc(m.replyTo.text)}</span></div>` : '';
    return divider + `<div class="chat-msg${m.everyone ? ' chat-everyone' : ''}" data-mid="${esc(m.id)}">
      ${quote}
      <span class="chat-who">${esc(m.who)}</span>
      <span class="chat-time" title="${esc(full)}">${esc(time)}</span>
      <span class="chat-mod"><a href="#" data-chatreply="${esc(m.id)}" data-replywho="${esc(m.who)}" data-replytext="${esc(String(m.text || '').slice(0, 140))}" title="Reply to this message">reply</a>${org && m.fafId ? ` <a href="#" data-chatdel="${esc(m.id)}" title="Delete message">\u2715</a> <a href="#" data-chatmute="${esc(m.fafId)}" data-chatmutename="${esc(m.who)}" title="Mute ${esc(m.who)}">mute</a>` : ''}</span>
      <div class="chat-text">${highlightMentions(m.text)}</div>
    </div>`;
  }).join('') || '<div class="empty">No messages yet. Say hi, or type <code>!roll</code>.</div>';
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

// Build a chat panel into `host` for the given room. Reusable by the tab and the match modal.
async function mountChat(host, room, label) {
  stopChatPoll();
  _chatRoom = room; _chatSince = 0; _chatMsgs = []; _chatReplyTo = null;
  host.innerHTML = `<div class="chat-panel">
    <div class="chat-head">${esc(label)}</div>
    <div class="chat-log" id="chatLog"><div class="empty">Loading\u2026</div></div>
    <div class="chat-replybar" id="chatReplyBar" style="display:none">
      <span class="crb-label">Replying to</span> <span class="crb-who" id="chatReplyWho"></span>
      <span class="crb-text" id="chatReplyText"></span>
      <button type="button" class="crb-x" id="chatReplyCancel" title="Cancel reply">\u00D7</button>
    </div>
    <div class="chat-input">
      <div class="chat-inwrap"><input type="text" id="chatText" maxlength="500" placeholder="${viewerIsOrganizer() ? 'Message\u2026 (@everyone to ping all entrants, @name to mention, !roll for 1\u2013100)' : 'Message\u2026 (!roll for 1\u2013100, !organizer to ping the organizers, @name to mention)'}" autocomplete="off"><div class="chat-mentions" id="chatMentions" style="display:none"></div></div>
      <button class="btn primary small" id="chatSend">Send</button>
      ${viewerIsOrganizer() ? '' : '<button class="btn ghost small" id="chatPing" title="Flags this chat for the organizers so they know you need help">\uD83D\uDD14 Ping organizer</button>'}
    </div>
    <div class="muted small" id="chatNote" style="margin-top:4px"></div>
  </div>`;
  const logEl = host.querySelector('#chatLog');
  const inp = host.querySelector('#chatText');
  const note = host.querySelector('#chatNote');

  const load = async (incremental) => {
    try {
      const tok = viewToken();
      const r = await api('/api/t/' + T.id + '/chat_read?room=' + encodeURIComponent(room) + (_chatSince ? '&since=' + _chatSince : '') + (tok ? '&token=' + encodeURIComponent(tok) : ''));
      if (r.muted) note.textContent = 'You are muted by an organizer \u2014 you can read but not post.';
      const incoming = r.messages || [];
      if (incoming.length) {
        if (incremental) _chatMsgs = _chatMsgs.concat(incoming);
        else _chatMsgs = incoming;
        _chatSince = _chatMsgs[_chatMsgs.length - 1].at;
        renderChatMessages(logEl);
      } else if (!incremental) {
        _chatMsgs = []; renderChatMessages(logEl);
      }
      // Reading the room clears its unread server-side, but the badges come from the cached
      // tournament view, and the poll deliberately doesn't redraw while you're in chat. Clear
      // them locally so the marker disappears as you read instead of on the next tab switch.
      clearUnreadFor(room);
    } catch (e) { note.textContent = e.message; stopChatPoll(); }
  };
  await load(false);

  // ---- reply / quote ----
  const replyBar = host.querySelector('#chatReplyBar');
  const replyWho = host.querySelector('#chatReplyWho');
  const replyText = host.querySelector('#chatReplyText');
  const clearReply = () => { _chatReplyTo = null; if (replyBar) replyBar.style.display = 'none'; };
  const setReply = (id, who, text) => {
    _chatReplyTo = id;
    if (replyWho) replyWho.textContent = who || '';
    if (replyText) replyText.textContent = text || '';
    if (replyBar) replyBar.style.display = '';
    inp.focus();
  };
  clearReply();
  const rc = host.querySelector('#chatReplyCancel');
  if (rc) rc.onclick = clearReply;
  // Escape cancels a reply before it does anything else.
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && _chatReplyTo) { ev.stopPropagation(); clearReply(); }
  });

  const send = async () => {
    const text = inp.value.trim();
    if (!text) return;
    const replyTo = _chatReplyTo;
    inp.value = '';
    try {
      await api('/api/t/' + T.id + '/chat_post', { room, text, replyTo: replyTo || undefined, token: viewToken() });
      clearReply();
      await load(true);
    } catch (e) { toast(e.message, true); inp.value = text; }
  };
  host.querySelector('#chatSend').onclick = send;

  // ---- @mention autocomplete (Discord-style) ----
  // Suggest from everyone signed up (players) plus team names, deduped. Typing "@" opens the
  // list; more letters filter it. Enter/Tab/click completes the current highlight.
  const mentionBox = host.querySelector('#chatMentions');
  const nameList = (() => {
    const set = new Map();
    // Organizers only: @everyone pings every signed-up account. Offered first so it is easy to
    // reach, and simply absent for anyone who isn't allowed to use it.
    if (viewerIsOrganizer()) set.set('everyone', 'everyone');
    for (const p of (T.players || [])) if (p && p.name) set.set(p.name.toLowerCase(), p.name);
    for (const tm of (T.teams || [])) if (tm && tm.name) set.set(tm.name.toLowerCase(), tm.name);
    return Array.from(set.values());
  })();
  let mMatches = [], mSel = 0, mStart = -1;

  const closeMentions = () => { mentionBox.style.display = 'none'; mMatches = []; mStart = -1; };
  const renderMentions = () => {
    if (!mMatches.length) { closeMentions(); return; }
    mentionBox.innerHTML = mMatches.map((nm, i) =>
      `<div class="chat-mention${i === mSel ? ' on' : ''}" data-mi="${i}">${esc(nm)}</div>`).join('');
    mentionBox.style.display = '';
    mentionBox.querySelectorAll('[data-mi]').forEach(d => {
      d.onmousedown = (ev) => { ev.preventDefault(); applyMention(+d.dataset.mi); };
    });
  };
  const applyMention = (i) => {
    const nm = mMatches[i];
    if (nm == null || mStart < 0) return;
    const before = inp.value.slice(0, mStart);
    const after = inp.value.slice(inp.selectionStart);
    // wrap names with spaces in the mention so it reads as one token
    const token = '@' + nm + ' ';
    inp.value = before + token + after;
    const pos = (before + token).length;
    inp.setSelectionRange(pos, pos);
    closeMentions();
    inp.focus();
  };
  const updateMentions = () => {
    const pos = inp.selectionStart;
    const upto = inp.value.slice(0, pos);
    // find the last "@" that starts a word and has no space since
    const at = upto.lastIndexOf('@');
    if (at < 0 || (at > 0 && !/\s/.test(upto[at - 1]))) { closeMentions(); return; }
    const frag = upto.slice(at + 1);
    if (/\s/.test(frag)) { closeMentions(); return; }   // already ended the mention
    mStart = at;
    const q = frag.toLowerCase();
    mMatches = nameList.filter(nm => nm.toLowerCase().includes(q)).slice(0, 8);
    mSel = 0;
    renderMentions();
  };
  inp.addEventListener('input', updateMentions);
  inp.addEventListener('click', updateMentions);

  inp.onkeydown = (e) => {
    if (mMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mSel = (mSel + 1) % mMatches.length; renderMentions(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); mSel = (mSel - 1 + mMatches.length) % mMatches.length; renderMentions(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyMention(mSel); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMentions(); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  };
  inp.addEventListener('blur', () => setTimeout(closeMentions, 120));
  const pingBtn = host.querySelector('#chatPing');
  if (pingBtn) pingBtn.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/chat_post', { room, text: '!organizer ' + (inp.value.trim() || ''), token: viewToken() });
      inp.value = '';
      toast('Organizers pinged');
      await load(true);
    } catch (e) { toast(e.message, true); }
  };

  logEl.onclick = async (e) => {
    const del = e.target.closest('[data-chatdel]');
    const mute = e.target.closest('[data-chatmute]');
    const rep = e.target.closest('[data-chatreply]');
    const jump = e.target.closest('[data-jump]');
    if (rep) {
      e.preventDefault();
      setReply(rep.dataset.chatreply, rep.dataset.replywho, rep.dataset.replytext);
      return;
    }
    if (jump) {
      // Scroll the quoted original into view and flash it, if it is still in the loaded history.
      const target = logEl.querySelector('[data-mid="' + jump.dataset.jump.replace(/"/g, '') + '"]');
      if (target) {
        target.scrollIntoView({ block: 'center' });
        target.classList.add('chat-flash');
        setTimeout(() => target.classList.remove('chat-flash'), 1200);
      } else { toast('That message is no longer in the loaded history'); }
      return;
    }
    if (del) {
      e.preventDefault();
      try { await api('/api/t/' + T.id + '/chat_delete', { room, id: del.dataset.chatdel, admin: adminToken() }); await load(false); }
      catch (er) { toast(er.message, true); }
    } else if (mute) {
      e.preventDefault();
      if (!confirm('Mute ' + mute.dataset.chatmutename + ' from all chat in this tournament?')) return;
      try { await api('/api/t/' + T.id + '/chat_mute', { fafId: mute.dataset.chatmute, name: mute.dataset.chatmutename, admin: adminToken() }); toast('Muted'); await load(false); }
      catch (er) { toast(er.message, true); }
    }
  };

  _chatPollNow = () => { if (_chatRoom === room) load(true); };
  _chatTimer = setInterval(() => {
    if (document.hidden) return;                       // tab in the background
    if (_chatRoom !== room) { stopChatPoll(); return; }
    if (document.activeElement === inp && inp.value) { /* still poll, just don't steal focus */ }
    load(true);
  }, 3500);
}

async function drawChatTab(el) {
  stopChatPoll();
  el.innerHTML = '<div class="panel section"><div class="empty">Loading chats\u2026</div></div>';
  let data;
  try { data = await chatRooms(); } catch (e) { el.innerHTML = '<div class="panel section"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
  const rooms = data.rooms || [];
  if (!rooms.length) { el.innerHTML = '<div class="panel section"><div class="empty">No chats available to you yet.</div></div>'; return; }
  // organizers listed one per row, with their Discord handle where they've set one
  const orgs = (T.organizersPublic || []).map(o => (typeof o === 'string' ? { name: o, discord: '' } : o));
  const orgLine = orgs.length
    ? `<div class="org-callout">
      <div class="org-callout-title">Organizer${orgs.length === 1 ? '' : 's'}</div>
      <div class="org-callout-list">${orgs.map(o => `<div class="org-row">
        <span class="org-name">${esc(o.name)}</span>
        ${o.discord ? '<span class="org-discord" title="Discord handle">' + esc(o.discord) + '</span>' : '<span class="muted small">no Discord listed</span>'}
      </div>`).join('')}</div>
      <div class="org-callout-hint">Type <code>!organizer</code> or press \uD83D\uDD14 to ping them in that chat.</div>
    </div>`
    : '';

  // Before the bracket starts, organizers often aren't watching chat - say so up front.
  const preStartNote = (T.status === 'signup')
    ? `<div class="panel section chat-prestart">
        <strong>Organizers may not be around before the tournament starts.</strong>
        <p class="muted small" style="margin:6px 0 0">Chat here is mostly between players until the event begins. If you need something answered sooner, message an organizer on Discord${orgs.some(o => o.discord) ? ' (' + orgs.filter(o => o.discord).map(o => esc(o.discord)).join(', ') + ')' : ''}.</p>
      </div>`
    : '';
  const roomBtn = (r) => {
    const badges = [];
    if (r.mention) badges.push('<span class="chat-mention-badge">1</span>');       // you were @mentioned
    else if (r.unread) badges.push('<span class="unread-dot">' + (r.unread > 9 ? '9+' : r.unread) + '</span>');
    if (r.ping && viewerIsOrganizer()) badges.push('\uD83D\uDD14');                  // organizer attention
    const cnt = r.count ? ' <span class="muted small">(' + r.count + ')</span>' : '';
    return `<button class="chat-room ${r.mention ? 'mentioned' : ''} ${r.ping && viewerIsOrganizer() ? 'pinged' : ''}" data-room="${esc(r.id)}" data-label="${esc(r.label)}">${badges.length ? '<span class="chat-room-badges">' + badges.join(' ') + '</span> ' : ''}${esc(r.label)}${cnt}</button>`;
  };
  const active = rooms.filter(r => !r.done);
  const completed = rooms.filter(r => r.done);
  // any completed room the viewer was @mentioned in should surface the group even when collapsed
  const completedMention = completed.some(r => r.mention);
  const listHtml = active.map(roomBtn).join('')
    + (completed.length
        ? `<button class="chat-room-group chat-group-toggle ${_chatCompletedOpen ? 'open' : ''}" id="chatCompletedToggle">
             <span class="cg-caret">${_chatCompletedOpen ? '\u25BE' : '\u25B8'}</span> Completed matches <span class="muted small">(${completed.length})</span>${completedMention && !_chatCompletedOpen ? ' <span class="chat-mention-badge">!</span>' : ''}
           </button>
           <div class="chat-completed" id="chatCompletedWrap" style="display:${_chatCompletedOpen ? '' : 'none'}">${completed.map(roomBtn).join('')}</div>`
        : '');
  el.innerHTML = preStartNote + `<div class="chat-layout">
    <div class="chat-rooms panel section">
      <h2>Chats</h2>
      ${orgLine}
      ${data.muted ? '<div class="warn small" style="margin-bottom:8px">You are muted.</div>' : ''}
      <div class="chat-roomlist">${listHtml}</div>
    </div>
    <div class="chat-host" id="chatHost"></div>
  </div>`;
  const host = el.querySelector('#chatHost');
  const pick = (btn) => {
    if (!btn) return;
    _chatActiveRoom = btn.dataset.room;
    el.querySelectorAll('.chat-room').forEach(b => b.classList.toggle('active', b === btn));
    mountChat(host, btn.dataset.room, btn.dataset.label);
  };
  el.querySelectorAll('.chat-room').forEach(b => b.onclick = () => pick(b));
  const cToggle = el.querySelector('#chatCompletedToggle');
  if (cToggle) cToggle.onclick = () => {
    _chatCompletedOpen = !_chatCompletedOpen;
    const wrap = el.querySelector('#chatCompletedWrap');
    if (wrap) wrap.style.display = _chatCompletedOpen ? '' : 'none';
    cToggle.classList.toggle('open', _chatCompletedOpen);
    const caret = cToggle.querySelector('.cg-caret');
    if (caret) caret.textContent = _chatCompletedOpen ? '\u25BE' : '\u25B8';
  };
  // Re-select the room the user was already in (if it still exists), not always Global — a
  // background refresh must not yank them back to the global chat.
  const prev = _chatActiveRoom && el.querySelector('.chat-room[data-room="' + (window.CSS && CSS.escape ? CSS.escape(_chatActiveRoom) : _chatActiveRoom) + '"]');
  pick(prev || el.querySelector('.chat-room'));
}

function openMatchChat(m) {
  const label = mLabel(m) + ' \u2014 ' + teamName(m.team1) + ' vs ' + teamName(m.team2);
  modal(`<h3>Match chat</h3><div id="mcHost" class="chat-compact"></div>
    <div class="actions"><button class="btn ghost" id="mcClose">Close</button></div>`, root => {
    root.querySelector('#mcClose').onclick = () => { stopChatPoll(); closeModal(); };
    mountChat(root.querySelector('#mcHost'), 'match:' + m.id, label);
  });
}

// ---------- routing ----------

async function refresh() {
  await loadTournament();
  lastSnapshot = JSON.stringify(T);
  drawTournament();
}

function syncTabURL() {
  const id = tourneyId();
  if (!id) return;
  const url = '/t/' + id + (currentTab && currentTab !== 'overview' ? '?tab=' + currentTab : '');
  history.replaceState(null, '', url);
}

function setTitle(name) {
  document.title = name ? (name + ' \u2014 FAF Tournaments') : 'FAF Tournaments';
}

function route() {
  if (location.pathname === '/series') renderSeriesIndex();
  else if (location.pathname.startsWith('/series/')) renderSeries(location.pathname.slice(8));
  else if (location.pathname === '/host') renderHost();
  else if (location.pathname === '/siteadmin') renderSiteAdmin();
  else if (location.pathname === '/editor') renderEditor();
  else if (location.pathname === '/importer') renderImporter();
  else if (location.pathname === '/hall') renderHall();
  else if (location.pathname === '/faq') renderFaq();
  else if (tourneyId()) renderTournament();
  else renderHome();
  refreshPending();
}

async function renderHall() {
  setTitle('Hall of Fame');
  drawTopbar('');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="page"><h1 style="margin:0 0 14px">Hall of Fame</h1><div id="hofBody"><div class="panel"><div class="empty">Loading…</div></div></div></div>';
  let data;
  try { const r = await fetch('/api/halloffame'); data = await r.json(); if (!r.ok) throw new Error(data.error || 'Failed to load'); }
  catch (e) { document.getElementById('hofBody').innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
  const players = data.players || [], teams = data.teams || [];
  let html = '<div class="panel section"><h2>Players <span class="muted small">(by championships)</span></h2>';
  if (!players.length) html += '<div class="empty">No results yet — win a tournament to get on the board.</div>';
  else html += '<table><thead><tr><th>#</th><th>Player</th><th>Wins</th><th>Entered</th></tr></thead><tbody>' +
    players.map((p, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(p.name)}</td><td class="mono">${p.wins}</td><td class="mono muted">${p.entered}</td></tr>`).join('') + '</tbody></table>';
  html += '</div><div class="panel section"><h2>Teams <span class="muted small">(by championships)</span></h2>';
  if (!teams.length) html += '<div class="empty">No champions yet.</div>';
  else html += '<table><thead><tr><th>#</th><th>Team</th><th>Wins</th></tr></thead><tbody>' +
    teams.map((t, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(t.name)}</td><td class="mono">${t.wins}</td></tr>`).join('') + '</tbody></table>';
  html += '</div>';
  document.getElementById('hofBody').innerHTML = html;
}

async function renderFaq() {
  setTitle('FAQ / Rules');
  drawTopbar('');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="page"><h1 style="margin:0 0 14px">FAQ / Rules</h1><div id="faqBody"><div class="panel"><div class="empty">Loading…</div></div></div></div>';
  let arts;
  try { const r = await fetch('/api/articles'); arts = await r.json(); if (!r.ok) throw new Error('Failed to load'); }
  catch (e) { document.getElementById('faqBody').innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
  const body = document.getElementById('faqBody');
  if (!arts.length) {
    body.innerHTML = '<div class="panel"><div class="empty">Nothing here yet.' + (siteAdmin() ? ' Add articles from the site-admin console (Articles tab).' : '') + '</div></div>';
    return;
  }
  const childrenOf = (id) => arts.filter(a => a.parentId === id);
  const topLevel = arts.filter(a => !a.parentId);

  // ?p=<id> opens a single sub-page (or a parent) with a back link
  const wanted = new URLSearchParams(location.search).get('p');
  const focus = wanted ? arts.find(a => a.id === wanted) : null;
  if (focus) {
    const kids = childrenOf(focus.id);
    let h = `<div class="panel section"><a href="/faq" class="muted small">\u2190 Back to FAQ / Rules</a>
      <h2 style="margin-top:8px">${esc(focus.title)}</h2>
      <div class="ic-body" style="margin-top:8px">${renderArticleBody(focus.body)}</div></div>`;
    if (kids.length) h += '<div class="panel section"><h2>Sub-pages</h2><div class="faq-sublinks">' +
      kids.map(k => `<a class="faq-sublink" href="/faq?p=${encodeURIComponent(k.id)}">${esc(k.title)} \u2192</a>`).join('') + '</div></div>';
    body.innerHTML = h;
    return;
  }

  // main page: each top-level article, with links to its sub-pages beneath it
  body.innerHTML = topLevel.map(a => {
    const kids = childrenOf(a.id);
    const sub = kids.length
      ? '<div class="faq-sublinks" style="margin-top:12px">' + kids.map(k => `<a class="faq-sublink" href="/faq?p=${encodeURIComponent(k.id)}">${esc(k.title)} \u2192</a>`).join('') + '</div>'
      : '';
    return `<div class="panel section"><h2>${esc(a.title)}</h2><div class="ic-body" style="margin-top:8px">${renderArticleBody(a.body)}</div>${sub}</div>`;
  }).join('');
}

window.addEventListener('popstate', route);
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="/"]');
  if (a && !a.dataset.goto) {
    e.preventDefault();
    history.pushState(null, '', a.getAttribute('href'));
    route();
  }
});

window.addEventListener('resize', () => { for (const f of connectorRedraws) f(); });
// mousewheel over a focused number input changes the value and blocks page zoom/scroll
document.addEventListener('wheel', () => {
  const a = document.activeElement;
  if (a && a.tagName === 'INPUT' && a.type === 'number') a.blur();
}, { passive: true });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { for (const f of connectorRedraws) f(); });

// handle the ?login=... param the OAuth callback appends, then clean it from the URL
function handleLoginParam() {
  const q = new URLSearchParams(location.search);
  const l = q.get('login');
  if (!l) return;
  q.delete('login');
  const clean = location.pathname + (q.toString() ? '?' + q.toString() : '');
  history.replaceState(null, '', clean);
  if (l === 'ok') toast('Logged in with FAF' + (me() ? ' as ' + me() : ''));
  else if (l === 'denied') toast('FAF login was cancelled', true);
  else if (l === 'expired') toast('Login timed out, please try again', true);
  else if (l === 'error') toast('FAF login failed, please try again', true);
}

applyScale();
refreshFafAuth().then(() => { handleLoginParam(); route(); });

// ---------------------------------------------------------------------------
// Stats tab — a public wrap-up shown once a tournament is finished. Everything
// here is derived from data players can already see (bracket results, rosters,
// maps played). Ban statistics stay on the organiser-only Vetoes panel.
// ---------------------------------------------------------------------------
function drawStats(el) {
  const done = (T.matches || []).filter(m => m.status === 'done' && m.bracket !== 'ffa');
  const teams = T.teams || [];
  const players = T.players || [];

  // games actually played: negative scores are the forfeit sentinel, not games. A walkover
  // (no-score forfeit) awards the winner maxW without anyone playing, so it contributes nothing.
  let games = 0, forfeits = 0, decidedByFf = 0;
  for (const m of done) {
    const walkover = !!m.forfeit && ((m.score1 != null && m.score1 < 0) || (m.score2 != null && m.score2 < 0));
    if (m.forfeit) { forfeits++; if (walkover) decidedByFf++; }
    if (walkover) continue;
    const a = (m.score1 != null && m.score1 > 0) ? m.score1 : 0;
    const b = (m.score2 != null && m.score2 > 0) ? m.score2 : 0;
    games += a + b;
  }

  // maps actually played, from completed vetoes (picks + decider) and direct round maps
  const playCount = {};
  for (const m of done) {
    const v = m.veto;
    if (!v) continue;
    for (const pk of (v.picks || [])) if (pk.map) playCount[pk.map] = (playCount[pk.map] || 0) + 1;
    if (v.decider && v.decider.map) playCount[v.decider.map] = (playCount[v.decider.map] || 0) + 1;
  }
  const mapIds = Object.keys(playCount);
  const topMaps = mapIds.slice().sort((a, b) => playCount[b] - playCount[a]).slice(0, 10);

  // ratings
  const rated = players.filter(p => p.rating != null);
  const avgRating = rated.length ? Math.round(rated.reduce((s, p) => s + p.rating, 0) / rated.length) : null;
  const fullTeams = teams.filter(t => (t.playerIds || []).length);
  const teamTotals = fullTeams.map(t => ({ t, r: teamRating(t) })).sort((a, b) => b.r - a.r);

  // longest series (most games in one match)
  let longest = null, longestN = 0;
  for (const m of done) {
    const n = ((m.score1 > 0 ? m.score1 : 0) + (m.score2 > 0 ? m.score2 : 0));
    if (n > longestN) { longestN = n; longest = m; }
  }
  const vetoesDone = done.filter(m => m.veto && m.veto.done).length;
  const champ = T.championTeamId ? teamName(T.championTeamId) : null;
  const solo = T.teamSize === 1 || T.formation === 'solo';

  const card = (label, value, sub) => `<div class="st-card">
      <div class="st-val">${value}</div>
      <div class="st-lbl">${esc(label)}</div>
      ${sub ? '<div class="st-sub muted small">' + sub + '</div>' : ''}
    </div>`;

  let html = '';
  if (champ) {
    html += `<div class="panel section st-champ"><div class="st-champ-lbl">Champion</div><h1 style="margin:4px 0 0">${esc(champ)}</h1></div>`;
  }

  html += '<div class="panel section"><h2>By the numbers</h2><div class="st-grid">';
  html += card(solo ? 'Entrants' : 'Players', players.length);
  if (!solo) html += card('Teams', fullTeams.length);
  html += card('Matches played', done.length);
  html += card('Games played', games, 'individual games across all series');
  if ((T.mapDb || []).length) html += card('Maps in the tournament', (T.mapDb || []).length);
  if (mapIds.length) html += card('Different maps played', mapIds.length);
  if (vetoesDone) html += card('Vetoes completed', vetoesDone);
  if (forfeits) html += card('Forfeits', forfeits, decidedByFf ? decidedByFf + ' with no games played' : '');
  if (avgRating != null) html += card('Average rating', avgRating, rated.length + ' rated ' + (solo ? 'entrants' : 'players'));
  html += '</div></div>';

  // podium / final standings, if the bracket produced them
  if (!solo && teamTotals.length) {
    html += `<div class="panel section"><h2>Team ratings</h2><div class="st-list">` +
      teamTotals.slice(0, 8).map((x, i) => `<div class="st-row">
        <span class="st-rank">${i + 1}</span>
        <span class="st-name">${esc(x.t.name)}</span>
        <span class="st-num mono">${x.r}</span></div>`).join('') +
      `</div><p class="muted small" style="margin-top:8px">Combined rating of each team's roster.</p></div>`;
  }

  // Map usage: every map that was available in this tournament, with how many times it was
  // actually played. Unplayed maps are listed too — "which maps never came up" is as interesting
  // as which ones did.
  const dbMaps = (T.mapDb || []).slice();
  if (dbMaps.length || mapIds.length) {
    // include any played map that is no longer in the database, so counts always add up
    const known = {};
    for (const m2 of dbMaps) known[m2.id] = m2.name;
    for (const id of mapIds) if (!known[id]) known[id] = mapName(id);
    const allIds = Object.keys(known);
    const playedIds = allIds.filter(id => playCount[id]);
    const unplayed = allIds.length - playedIds.length;
    const max = playedIds.length ? Math.max.apply(null, playedIds.map(id => playCount[id])) : 1;

    // distribution: how many maps were played N times
    const buckets = {};
    for (const id of allIds) { const n = playCount[id] || 0; buckets[n] = (buckets[n] || 0) + 1; }
    const bucketLine = Object.keys(buckets).map(Number).sort((a, b) => b - a).map(n =>
      buckets[n] + ' map' + (buckets[n] === 1 ? '' : 's') + ' ' + (n === 0 ? 'never played' : 'played ' + n + '\u00d7')
    ).join(' \u00b7 ');

    const sorted = allIds.sort((a, b) => (playCount[b] || 0) - (playCount[a] || 0) || String(known[a]).localeCompare(String(known[b])));
    html += `<div class="panel section"><h2>Map usage</h2>
      <p class="muted small" style="margin:-4px 0 10px"><strong>${allIds.length}</strong> map${allIds.length === 1 ? '' : 's'} available \u00b7 <strong>${playedIds.length}</strong> played \u00b7 <strong>${unplayed}</strong> never played<br>${esc(bucketLine)}</p>
      <div class="st-list">` +
      sorted.map(id => {
        const n = playCount[id] || 0;
        return `<div class="st-row${n ? '' : ' st-unused'}">
          <span class="st-name">${esc(known[id])}</span>
          <span class="st-bar"><span class="st-fill" style="width:${n ? Math.max(4, n / max * 100) : 0}%"></span></span>
          <span class="st-num mono">${n || '\u2014'}</span></div>`;
      }).join('') +
      `</div></div>`;
  }

  if (longest && longestN > 1) {
    html += `<div class="panel section"><h2>Longest series</h2>
      <p>${esc(mLabel(longest))} — <strong>${esc(teamName(longest.team1))}</strong> vs <strong>${esc(teamName(longest.team2))}</strong>
      went ${longestN} games (${(longest.score1 > 0 ? longest.score1 : 0)}\u2013${(longest.score2 > 0 ? longest.score2 : 0)}).</p></div>`;
  }

  el.innerHTML = html || '<div class="panel"><div class="empty">No statistics available.</div></div>';
}

// ---------------------------------------------------------------------------
// Tournament series — a grouping label only. Editions are independent events
// that happen to share a name; there is no qualification between them.
// ---------------------------------------------------------------------------
async function renderSeriesIndex() {
  setTitle('Series');
  stopPoll();
  drawTopbar('');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="page"><h1 style="margin:0 0 14px">Tournament series</h1><div id="srBody"><div class="panel"><div class="empty">Loading…</div></div></div></div>';
  let data;
  try { const r = await fetch('/api/series'); data = await r.json(); if (!r.ok) throw new Error(data.error || 'Failed to load'); }
  catch (e) { document.getElementById('srBody').innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
  // creating a series needs tournament-hosting permission (which already includes admins/directors)
  const canEdit = !!(fafAuth.user && (fafAuth.user.allowed || fafAuth.user.siteAdmin || fafAuth.user.director));
  const list = data.series || [];
  let html = '';
  if (canEdit) {
    html += `<div class="panel section"><h2>New series</h2>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <input type="text" id="srName" placeholder="Series name (e.g. Monthly Blitz)" style="flex:1;min-width:220px">
        <button class="btn primary" id="srCreate">Create</button>
      </div>
      <p class="muted small" style="margin-top:8px">A series just groups editions together for browsing. Anyone who can host a tournament can create one; organizers attach their tournament to a series from its Admin tab. Only the creator (or a director / site admin) can rename or delete a series.</p></div>`;
  }
  const officialOnly = _srOfficialOnly;
  const shown = officialOnly ? list.filter(x => x.category === 'official') : list;
  const active = shown.filter(x => (x.activeCount || 0) > 0);
  const dormant = shown.filter(x => !(x.activeCount || 0));   // already newest-first from the server

  const row = (s) => `<a class="sr-item" href="/series/${esc(s.id)}" data-link>
      <div class="sr-item-main">
      <div class="sr-name c-${esc(s.color || 'amber')}">${esc(s.name)}${s.category ? ' <span class="idbadge ' + (s.category === 'official' ? 'verified' : 'late') + '">' + esc(s.category.toUpperCase()) + '</span>' : ''}</div>
      ${s.description ? '<div class="muted small sr-summary">' + esc(stripMd(s.description)) + '</div>' : ''}
      ${s.latestName ? '<div class="muted small">Latest: ' + esc(s.latestName) + (s.latestDate ? ' \u00b7 ' + esc(fmtDate(s.latestDate)) : '') + '</div>' : ''}</div>
      <span class="sr-right">
        ${(s.activeCount || 0) > 0 ? '<span class="sr-live">' + s.activeCount + ' running</span>' : ''}
        <span class="sr-count">${s.editions} edition${s.editions === 1 ? '' : 's'}</span>
      </span>
    </a>`;

  html += `<div class="panel section">
    <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <h2 style="margin:0">Series <span class="h2-strong">(${shown.length}${officialOnly ? ' of ' + list.length : ''})</span></h2>
      <label class="sr-filter"><input type="checkbox" id="srOfficial"${officialOnly ? ' checked' : ''}> Official only</label>
    </div>`;
  if (!shown.length) {
    html += '<div class="empty">' + (officialOnly && list.length ? 'No official series yet.' : 'No series yet.') + '</div>';
  } else {
    if (active.length) html += '<div class="sr-group">Running now</div><div class="sr-list">' + active.map(row).join('') + '</div>';
    if (dormant.length) html += '<div class="sr-group"' + (active.length ? ' style="margin-top:16px"' : '') + '>Nothing scheduled \u2014 most recent first</div><div class="sr-list">' + dormant.map(row).join('') + '</div>';
  }
  html += '</div>';
  document.getElementById('srBody').innerHTML = html;
  wireSeriesLinks();
  { const of = document.getElementById('srOfficial');
    if (of) of.onchange = () => { _srOfficialOnly = of.checked; renderSeriesIndex(); }; }
  const c = document.getElementById('srCreate');
  if (c) c.onclick = async () => {
    const name = (document.getElementById('srName').value || '').trim();
    if (!name) return toast('Enter a series name', true);
    try { await api('/api/series', { action: 'create', name }); toast('Series created'); renderSeriesIndex(); }
    catch (e) { toast(e.message, true); }
  };
}

async function renderSeries(id) {
  stopPoll();
  drawTopbar('');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="page"><div id="srBody"><div class="panel"><div class="empty">Loading…</div></div></div></div>';
  let data;
  try { const r = await fetch('/api/series/' + encodeURIComponent(id)); data = await r.json(); if (!r.ok) throw new Error(data.error || 'Failed to load'); }
  catch (e) { document.getElementById('srBody').innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div><p><a href="/series" data-link>← All series</a></p></div>'; return; }
  const s = data.series, eds = data.editions || [];
  setTitle(s.name);
  const done = eds.filter(e => e.status === 'finished' && !e.abandoned);
  let html = `<p class="muted small" style="margin:0 0 6px"><a href="/series" data-link>← All series</a></p>
    <h1 class="sr-title c-${esc(s.color || 'amber')}" style="margin:0 0 4px">${esc(s.name)}${s.category ? ' <span class="idbadge ' + (s.category === 'official' ? 'verified' : 'late') + '" style="vertical-align:middle">' + esc(s.category.toUpperCase()) + '</span>' : ''}</h1>
    ${s.description ? '<div class="ic-body series-desc">' + renderArticleBody(s.description) + '</div>' : '<div style="height:10px"></div>'}
    <div class="panel section"><h2>Editions <span class="h2-strong">(${eds.length})</span></h2>`;
  if (!eds.length) html += '<div class="empty">No tournaments in this series yet.</div>';
  else html += '<div class="sr-eds">' + eds.map(e => {
    const kind = e.competition === 'ffa' ? 'FFA' : (e.teamSize + 'v' + e.teamSize + ' ' + ({ single: 'SE', double: 'DE', swiss: 'Swiss' }[e.bracketType] || ''));
    const state = e.abandoned ? 'abandoned' : e.status;
    return `<a class="sr-ed" href="/t/${esc(e.id)}" data-link>
      <div class="sr-ed-main">
        <div class="sr-ed-name">${esc(e.name)}${e.published === 0 ? ' <span class="idbadge late">draft</span>' : ''}</div>
        <div class="muted small">${esc(kind)}${e.eventDate ? ' \u00b7 ' + esc(fmtDate(e.eventDate)) : ''}${e.champion ? ' \u00b7 winner: ' + esc(e.champion) : ''}</div>
      </div>
      <span class="pill ${esc(state)}">${esc(statusLabel(e.status) || state)}</span>
    </a>`;
  }).join('') + '</div>';
  html += '</div>';
  if (done.length) {
    const wins = {};
    for (const e of done) if (e.champion) wins[e.champion] = (wins[e.champion] || 0) + 1;
    const ranked = Object.keys(wins).sort((a, b) => wins[b] - wins[a]);
    if (ranked.length) {
      html += '<div class="panel section"><h2>Series winners</h2><div class="st-list">' +
        ranked.map((n, i) => `<div class="st-row"><span class="st-rank">${i + 1}</span><span class="st-name">${esc(n)}</span><span class="st-num mono">${wins[n]}</span></div>`).join('') +
        '</div></div>';
    }
  }
  if (data.canEdit) {
    html += `<div class="panel section"><h2>Manage</h2>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:200px"><label>Name</label><input type="text" id="srEdName" value="${esc(s.name)}"></div>
      </div>
      <label style="margin-top:10px">Type</label>
      <select id="srEdCat">
        <option value=""${!s.category ? ' selected' : ''}>\u2014 unset \u2014</option>
        <option value="official"${s.category === 'official' ? ' selected' : ''}>Official</option>
        <option value="community"${s.category === 'community' ? ' selected' : ''}>Community</option>
      </select>
      <label style="margin-top:10px">Name colour</label>
      <div class="sr-swatches" id="srColors">
        ${['amber','blue','green','red','purple','plain'].map(c =>
          `<button type="button" class="sr-swatch c-${c}${(s.color || 'amber') === c ? ' on' : ''}" data-srcolor="${c}" title="${c}">Aa</button>`).join('')}
      </div>
      <label style="margin-top:10px">Description</label>
      ${mdToolbarHTML()}
      <textarea id="srEdDesc" rows="10">${esc(s.description || '')}</textarea>
      <div class="actions"><button class="btn ghost" id="srDel">Delete series</button><button class="btn primary" id="srSave">Save</button></div>
      <p class="muted small">Deleting a series does not delete its tournaments — they simply stop being grouped.</p></div>`;
  }
  document.getElementById('srBody').innerHTML = html;
  wireSeriesLinks();
  let srColor = s.color || 'amber';
  document.querySelectorAll('[data-srcolor]').forEach(b => b.onclick = () => {
    srColor = b.dataset.srcolor;
    document.querySelectorAll('[data-srcolor]').forEach(x => x.classList.toggle('on', x === b));
    const h1 = document.querySelector('.sr-title');
    if (h1) h1.className = 'sr-title c-' + srColor;   // live preview
  });
  const sv = document.getElementById('srSave');
  if (sv) sv.onclick = async () => {
    try {
      await api('/api/series', { action: 'update', id: s.id, name: document.getElementById('srEdName').value, description: document.getElementById('srEdDesc').value, color: srColor, category: document.getElementById('srEdCat').value });
      toast('Saved'); renderSeries(s.id);
    } catch (e) { toast(e.message, true); }
  };
  const dl = document.getElementById('srDel');
  if (dl) dl.onclick = async () => {
    if (!confirm('Delete the series "' + s.name + '"? Its tournaments stay, they just lose the grouping.')) return;
    try { await api('/api/series', { action: 'delete', id: s.id }); toast('Series deleted'); nav('/series'); }
    catch (e) { toast(e.message, true); }
  };
}

// intercept in-app links so series pages don't do a full page load
function wireSeriesLinks() {
  document.querySelectorAll('[data-link]').forEach(a => a.onclick = (e) => {
    e.preventDefault();
    nav(a.getAttribute('href'));
  });
}
