# FAF Tournaments

Self-hosted tournament manager for the FAF (Supreme Commander: Forged Alliance Forever) community.

Zero runtime dependencies: plain Node.js (built-in `http` only), JSON file storage, no build step, no `npm install` in production. The container clones the repo and runs `server.js` directly.

---

## Features

### Formats
- Team brackets 1v1 to 6v6, or FFA (solo, or teams).
- Single elimination, double elimination (with an optional "upper-bracket finalist starts the grand final 1-0 up"), Swiss, or FFA.
- FFA modes: points over rounds (placement points per lobby, optional cut after each round, optional final lobby between the top X) or knockout (top 1-4 advance per lobby).
- Swiss: Bo1/Bo3 rounds, optional final between the top 2, optional fast pairing (next matchup starts as soon as two teams are free).
- Best-of per round: set presets at creation, or turn on **per-round Bo** to give every winners/losers/grand-final round its own best-of. Per-round Bo is editable on the Bracket tab both before generation (on the preview) and after (on the live bracket, affecting only rounds whose matches haven't started). The format summary collapses equal consecutive rounds, e.g. "WB R1-2 Bo3 - WB R3 Bo5 - LB R1-2 Bo1 - GF Bo5".
- First-round byes are not drawn. A seed with a bye appears directly in its round-2 match, which keeps large brackets compact. The losers bracket hides the phantom matches that byes would create, matching exactly what the engine generates.
- Optional max teams/entrants cap and optional minimum-teams target.

### Identity and access (FAF login)
- FAF OAuth login (OpenID Connect via Ory Hydra). It stays dormant until the three `FAF_*` environment variables are set; without them the site runs the legacy name-only flow unchanged, so any build is safe to deploy at any time.
- With FAF login on, actions are gated by FAF identity: players carry their FAF account, captains act by their FAF identity (no per-captain links), and the player's rating is pulled from FAF automatically at signup (see Ratings).
- Hosting approval: when FAF login is on, creating a tournament requires per-account approval by a site admin (Requests tab) or a directorship. When it is off, anyone can create, as before.

### Ratings
- A tournament's rating type (global, 1v1, 2v2, 3v3, 4v4, ranked-change, or none) is set at creation.
- For a rated tournament with FAF login on, the player's rating is fetched from FAF automatically at signup - the player never types it. An optional rating date pulls each player's rating as of that date rather than "now"; the date is editable on the Admin tab and shown to players.
- Only an unrated tournament (`none`) asks players to enter a rating manually. This applies to normal signups and to late signups via the late-signup link.

### Teams and seeding
- **Premade teams** and **captain draft** are the two team modes. "Premade teams" uses a create-team / request-to-join / invite system: players sign up solo, then either create a team (becoming captain) or join one. Captains (and organizers) can invite pool players directly, and teamless players can request to join a team; the captain approves or declines. Only full teams enter the bracket; incomplete teams become reserves.
- Captain draft with pick order (bottom-to-top every round, or snake) and a live pick-order display. A captain can undo their own most recent pick until the next captain picks; the organizer can undo the last pick at any time.
- Solo brackets: every signup is an entrant.
- Seeding by rating or random, with a manual seed override before the bracket starts (reorder, nudge, randomize, reset). During team formation, the Teams tab lists teams by combined rating and shows each team's projected seed (its rank by rating) until real seeds are locked.
- King/Prince divisions: split full teams into skill divisions by combined rating, each playing its own bracket (single/double elim only).
- Free agents (players not yet on a team) get their own prominent panel with a card per player, sortable by rating, name or newest, showing the pool's average rating and invite/assign actions.
- Withdrawing or removing a player detaches them cleanly from any team (captain reassigns to the next member; emptied teams are removed during signup), so teams never keep a "ghost" slot.

### Team rename
- Organizers and site admins can rename any team, any time, as often as needed.
- In a team game (more than one player per team), a captain gets a single one-time rename of their own team. Solo tournaments have no captain rename. Duplicate names are rejected.

### Maps, pools, and vetoes
- A per-tournament map database with preview images, descriptions, and publish/hide. On the Maps tab, pools are listed first, then an "All maps" grid. A map card shows "Played in [rounds]" only for direct round assignments, and "In pool: [name]" for pool membership.
- Named map pools, each with its own best-of and its own ban/pick order. The edit-pool dialog shows a live map count and the number of ban/pick steps required. A pool's sequence length is tied to its size so that exactly one map is left as the decider, which means one order cannot serve pools of different sizes even at the same best-of.
- Publishing a pool also publishes every hidden map inside it (a published pool is shown to players, so its maps must be visible too).
- Pools can be assigned to whole rounds or to specific matches, including before the bracket is generated (rounds are projected from the expected team count). Reassigning a pool re-initialises the veto on affected ready matches, so a fixed pool takes effect immediately.
- Optional per-match veto engine: the two sides (Team A acts first) alternate bans and picks per the pool's order. A veto runs only when the assigned pool's best-of matches the match's best-of and both teams are known. A/B sides are decided per match by the captain's rating (random / lower-rated-is-A / lower-rated-is-B / manual). "All upfront" completes the whole ban/pick before game 1; "continuous" reveals steps as games are played. Vetoes can be enabled or disabled mid-bracket.
- A veto is closed automatically when its match gets a result. A match settled mid-veto (a forfeit, or an organizer correction) leaves a veto that can never be acted on again, so it is marked **CLOSED** and moved out of the in-progress list rather than sitting there forever. Undoing the result reopens it.
- Every veto shows a numbered **ban / pick order** log - which team banned or picked which map, in the order it happened, ending with the decider. It is shown both while the veto is running and after it completes.
- Maps are referenced by id everywhere and resolved to names at display time, so renaming a map updates it everywhere and deleting one cascades cleanly.

### Running a tournament
- Launch queue shows what is next; running scores (e.g. 1-0 in a Bo3) display live.
- Captains report their own matches; the organizer can correct results.
- Organizer score reporting supports an explicit winner and replay IDs together: you can record a match as, say, 1-1 with one team marked the winner (green) and keep the replay IDs - useful when a series was tied and decided by a forfeit. A pure forfeit (no games played) marks the losing side "FF" and awards the win; either way the correct team advances and the match is tagged FORFEIT.
- A personal **Show players** toggle swaps team names for that team's players everywhere they appear: the bracket, the Matches tab, the Vetoes tab (including the ban/pick log and A/B legend) and the match-details popup. Labels stay on one line and truncate with an ellipsis, with the full team name on hover. Labels stay on one line and truncate with an ellipsis, and the score is never pushed out of view.
- Clicking a team anywhere in the bracket opens a popup listing its members, ratings, captain, seed, and combined rating.
- Player editing at any time (this is also the substitution mechanism).
- Standings tab: placements for elimination formats, W/L/game-diff for Swiss, points leaderboard for FFA.

### Matches tab
- A flat, observer-friendly list of every match: **My matches** (if you are in one), Ongoing & upcoming, Not yet decided, and Concluded. Columns are round, both teams, status, and result.
- Status follows the pipeline: Waiting -> Picks & bans -> Ready/Live -> Concluded.
- Clicking a match opens details: both rosters with ratings and captain, the score, the winner, and the full ban/pick history, plus a match-chat link.
- Score reporting is offered here on exactly the same terms as on the bracket, so a captain who may submit there may submit here.
- Fully streamer-mode aware: results are masked, teams fed by an unrevealed match stay hidden, and each row (and the popup) has a Reveal/Hide button.
- This is an alternative view. It replaces nothing - the bracket, Vetoes tab and chat are unchanged.

### Statistics
- When a tournament finishes, a public **Stats** tab appears: entrants/players, teams, matches played, games played, different maps played, vetoes completed, forfeits, average rating, team ratings, highest-rated player, most-played maps, and the longest series.
- Games played counts only games that were actually played: a walkover forfeit (no games) contributes nothing, while a series that was played and then forfeited still counts its real games.
- Map *ban* statistics remain on the organiser-only panel in the Vetoes tab; the public page shows maps played, which is already visible from the bracket.

### Parent / child tournaments (qualification)
- A tournament can draw its field from one or more **qualifiers**. On the parent's Admin tab, add a qualifier and a rule: *top N advance* (any format) or *N+ points advance* (Swiss / FFA).
- When a qualifier finishes, the entrants who meet the rule are **invited automatically** - they are not signed up. Accepting is up to them, and the invite appears in the parent's Invited list tagged with the qualifier it came from. Manual invites and normal signups are unaffected.
- For a team tournament the **team** qualifies and every member is invited; for a solo bracket the player is invited. An entrant with no linked FAF account cannot be invited automatically and is listed so the organizer can chase them.
- Rankings come from the finished tournament: final placement for elimination brackets (ordered by how late a team was knocked out), Swiss standings, or the FFA leaderboard.
- Both sides show it: a qualifier displays "the top N here will be invited to X", and the parent lists where its field comes from and who has qualified.
- Seeding in the parent is by rating as usual, with the normal manual seed override.
- The link is stored only on the parent, so the two sides can never disagree. Removing a link keeps invites already sent. Self-links and circular links are rejected.

### Tournament series
- A **series** groups editions of a recurring event (e.g. a monthly cup) purely for browsing. Editions are completely independent: no qualification, no fixed cadence, no shared state.
- Anyone with tournament-hosting permission can create a series. Renaming or deleting one is limited to its creator, anyone who organizes a tournament in that series, directors, and site admins.
- A series can be chosen when creating a tournament (an optional field on the host form), or set and changed later from the Admin tab. Copying an existing tournament to make the next edition inherits its series.
- `/series` lists every series with its edition count; `/series/<id>` shows that series' editions newest first, with each edition's format, date, status and winner, plus a "series winners" tally.
- A tournament that belongs to a series shows a "Part of the X series" block near the bottom of its overview, linking to the series page.
- Deleting a series never deletes tournaments - they simply stop being grouped.

### Chat
- Per-tournament chat with a Global room and a room per match (created only once both teams are known). Match chats for finished matches collapse into a "Completed matches" group, minimised by default.
- `@name` mention autocomplete (Discord-style): type `@`, a filtered dropdown of players and team names appears, and the mention is highlighted in the message. A mentioned FAF player who is signed up gets a red badge on that room and on the CHAT tab until they read it.
- `!organizer` (or the ping button) flags a room for the organizers; `!roll` posts a 1-100 roll.
- Match chats are also linked from the Bracket and Vetoes tabs.

### Vetoes tab
- Shows each match's ban/pick veto. Players see only vetoes for matches their own team is in; organizers, casters (streamer link), tournament directors on official events, and site admins see all.
- In-progress vetoes are listed first (newest round first), then completed ones (highlighted, with the decided maps).
- On a **finished** tournament, a Veto statistics panel shows "most banned" and "most played" maps. It is visible only to organizers of that tournament, tournament directors (on official tournaments), and site admins.

### Keyboard shortcuts
- Single keys, no modifiers: **F** shows players instead of team names in the bracket, **S** toggles streamer mode, **V** toggles view-as-player (organizers only).
- All three are rebindable in Display settings: click the key, press the one you want, or clear it to switch that shortcut off. Two actions can't share a key - binding one takes it from the other.
- Shortcuts are ignored while you're typing in any field and while a dialog is open, and they only affect your own screen.

### Streamer mode and view-as-player (personal, per-browser toggles)
- **Streamer mode** hides match results, scores, and who has advanced (a later slot shows "Winner of WB R1 M1" instead of the team), plus elimination styling and the standings table - for on-stream reveals. Each completed match has a "Reveal result" button to un-mask it one at a time; reveals persist across refreshes. Streamer mode only affects your own screen and never changes permissions.
- **View as player** (shown only to organizers/admins) hides the organizer and admin controls on your screen so you can browse a tournament as a regular participant. It is a display filter only and does not change your actual permissions.

### Drafts and scheduled publishing
- Unpublished tournaments are listed in a **My drafts** section at the top of the home page, visible only to their organizers and site admins.
- A draft can be published immediately or **scheduled**: enter a UTC date and time and it publishes itself. There is no background timer - the schedule is applied whenever tournaments are listed, which covers every way a tournament becomes visible. A pending schedule is shown on the draft banner and can be cancelled.

### Dates and time zones
- An optional **overall cash prize** (currency plus a number, USD/EUR/RUB) is stored separately from the free-text Rewards and shown as its own box at the top of them, so it reads at a glance and can be reused in listings. The amount accepts digits only.
- Optional event date and time (entered in UTC) per tournament, editable any time.
- Stored in UTC, displayed in each viewer's chosen time zone (remembered per browser). The Completed list is ordered most-recent-first.
- Display settings (the gear icon) also choose the **date format** (`7 Jul 2026`, `07/07/2026`, or `2026-07-07`) and the **time format** (24-hour or 12-hour). These are per browser. Note that the placeholder inside a native date-picker field follows the browser's own locale and cannot be overridden by the site.
- The overview's "latest update" news block is hidden once a tournament is finished.

### Importing from Challonge
- Import a completed Challonge tournament (single or double elimination) as a read-only bracket via the Import button. Bracket topology, per-game series scores, and final placements are reconstructed.
- A Challonge API v1 key is entered per import and never stored.

---

## Roles and access

Access is by FAF identity when FAF login is on. The roles:

- **Site admin** - a FAF-linked identity with full control of the server, including deletion. Site admins are managed in the `/siteadmin` console (add/remove by FAF name or id, with a last-admin guard). The `ADMIN_PASSWORD` is not itself an admin login; it is used once to *link* the currently logged-in FAF account as a site admin (log in with FAF, then submit the password on `/siteadmin`). Because that link always re-adds, the password holder can never be locked out.
- **Tournament director** - has organizer rights on all official tournaments, plus a director console (bans, logs, archived tournaments, articles). Managed by site admins.
- **Organizer** - whoever creates a tournament. Any organizer can add co-organizers to their own tournament (by FAF name or id); only a site admin can remove one. With FAF login on, organizers are recognised by their FAF identity. (The old "organizer link" has been removed; add organizers via the Organizers panel instead.)
- **Editor** and **Importer** - request-or-grant roles. A user can request the role and a site admin approves in the Requests tab, or a site admin grants it directly. Importer allows using the Challonge importer; editor allows editing content as configured.
- **Captains** - with FAF login on, captains act by their FAF identity: they draft on their turn, invite/approve teammates, ban/pick in the veto, report their matches, and get one team rename in team games.
- **Bans** - site admins and directors can ban FAF accounts from participating.
- **Everyone else** - the public view is read-only plus signup.

---

## Architecture

Plain `http` server, no framework, JSON file storage. The code is split into small modules; there is still no build step and no runtime dependency.

```
server.js            HTTP layer: router, auth/OAuth, sessions, static + image serving,
                     storage (loadDB/saveDB with self-healing migrations), audit,
                     hosting approval, roles (site admins, directors, editors, importers, bans)
challonge.js         Challonge import
lib/util.js          leaf helpers (ids, names, dates, base64url, entity lookups, ...)
lib/bracket.js       pure bracket math (seeding, sizing, best-of validation, per-round Bo lists)
lib/match.js         match core + veto engine (create/route/evaluate/finalize with optional
                     forced winner, builders, pools, ban/pick sequence, A/B)
lib/swiss.js         Swiss standings/pairing/progression
lib/ffa.js           FFA groups/points/ranking/rounds
lib/teams.js         team formation (open create/join/invite, draft, seeding)
lib/maps.js          map lookups and the public (id-stripped) map view
public/index.html
public/app.js        client (loaded first; shared globals, helpers, streamer/player-view state)
public/app.home.js   client (home, tournament shell, overview, header toggles, poll loop)
public/app.entrants.js  client (players, teams/draft/open-team invites, start config)
public/app.bracket.js   client (bracket/rounds, per-round Bo, bye hiding, veto, veto stats, team popup)
public/app.results.js   client (report/forfeit, standings, chat, admin, routing)
public/style.css
docker-compose.yml
```

The client is delivered as several ordinary (non-module) scripts loaded in order; together they run in one shared global scope, exactly as a single file would.

### Storage
A single JSON file at `DATA_DIR/db.json`, keyed by `tournaments`, `sessions` (FAF login), `oauthPending`, `auditLog` (capped at 5000), `hostRequests`, `hostAllowed`, `siteAdmins`, `directors`, `editorAllowed`/`editorRequests`, `importerAllowed`/`importerRequests`, `bans`, and `series` (tournament series; each tournament may carry a `seriesId`). Per-user chat `@mention` pings are tracked per tournament. Map preview images are written as binary to `MAP_IMG_DIR` and served from `/map-images/<file>`; `db.json` stores only the filename.

On load, `loadDB` runs small self-healing migrations: legacy "premade" tournaments are converted to the create/join/invite model, and teams with stale member ids (from an old withdrawal) are repaired. These only touch data during signup and never remove a team that has real players.

---

## Run it

Any Docker host:

```
docker compose up -d
```

Edit the repo URL in `docker-compose.yml` to point at your fork. The container clones the repo at start and runs `server.js` - no image build needed. It listens on port 8090. Data lives in the `faf_tourney_data` volume and survives restarts; deleting the volume deletes all tournaments.

### Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 8090). |
| `DATA_DIR` | Where `db.json` is stored (default `./data`). |
| `ADMIN_PASSWORD` | Bootstrap for site admin: log in with FAF, then submit this password on `/siteadmin` to link your account as a site admin. Not set = the console can't be bootstrapped. |
| `FAF_CLIENT_ID` | FAF OAuth client id. |
| `FAF_CLIENT_SECRET` | FAF OAuth client secret (never in the repo). |
| `FAF_REDIRECT_URI` | Must exactly match what FAF registered, e.g. `https://your.host/auth/faf/callback`. |
| `MAP_IMG_DIR` | Optional. Where map images are written (default `DATA_DIR/map-images`). Set to relocate them to another drive. |

FAF login is active only when all three `FAF_*` variables are set. Removing them reverts to the legacy name-only flow (a safe rollback). Set secrets in your compose/stack config, never in the repo.

`IMPORT_PASSWORD` is no longer used - importer access is now a role granted in the site-admin console. If it is still set in your environment it is simply ignored.

### First site admin
With FAF login on, do this once after deploy: log in with FAF, open `/siteadmin`, and submit `ADMIN_PASSWORD`. That links your FAF account as a site admin. From then on, manage admins, directors, and other roles from the console; the password is only ever needed to (re-)link an account.

---

## Updating

Overwrite the changed files on GitHub (the web UI upload works; the folder structure in an update zip matches the repo), then restart the container - it re-clones on start. Update zips may include files under `lib/`; make sure those land in the repo's `lib/` folder, not the root.

If updates do not appear after a restart: static files are served with no-cache headers, but a reverse proxy in front (e.g. Nginx Proxy Manager) may cache CSS/JS itself. Turn OFF any "Cache Assets" option on the proxy host, then hard-refresh once (Ctrl+Shift+R). Favicons cache aggressively - reopen the tab if the icon looks stale.

---

## Development

No dependencies are needed to run the app. For editing there are optional dev-only tools (`typescript`, `@types/node`) declared in `package.json`; they never run in production (the container only clones and runs `node server.js`).

- Syntax check every source file: `npm run check`
- Type-check (JSDoc + `// @ts-check`, no emit): `npm run typecheck`

Type-checking is opt-in per file via a top-of-file `// @ts-check` comment; `lib/util.js` and `lib/bracket.js` are checked today, the larger modules are not yet annotated. There is no compile step - `@ts-check` catches bugs in the editor and CI without changing what runs.
