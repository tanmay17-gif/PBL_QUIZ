# Interactive Library Game — PBL Week 2026 · GNIMS Library

Three screens. No projector page — plain Chrome on `/` IS the event screen.

## Run
1. `npm --prefix server install` + `npm --prefix client install`
2. `npm --prefix client run build` (once — `:3001` serves the app, so `/` never shows `Cannot GET /`)
3. `node server/index.js` → http://localhost:3001/
   - `/` — MAIN EVENT SCREEN (project this; lobby QR + auto game)
   - `/play` — student phones (QR points here, code BOOK26)
   - `/admin` — one-button admin
4. Dev alternative: server `:3001` + `npm --prefix client run dev` (`:5173`).

Phones on LAN: `client/.env` → `VITE_SERVER=http://<laptop-ip>:3001`, rebuild.

## Event night
OPEN `/` → QR APPEARS → students scan → names slip in live → admin opens `/admin` →
waits → clicks START GAME → main screen auto-runs:
SECTION INTRO (5s) → ROUND INTRO (5s) → MEMORIZE/FLASH → QUESTION (15–30s) →
LOCK → REVEAL → DISCOVERY (full card on phones only) → LEADERBOARD → … → ROUND 10 → champions.

Admin secondary: Pause / Resume / End game. Nothing else to click.

## Scoring (server-authoritative, speed-based)
Correct + faster = more: `base × (0.5 + 0.5 × remaining/total)` + rank bonus 25/15/10.
Wrong = 0 (Round 6 RISK wrong = −100, totals clamped ≥ 0). First answer locks.
Verified live: 123 > 107, wrong 0.

## Admin
One active host, server-enforced: first `/admin` to claim (token in sessionStorage)
controls the game; others see HOST ALREADY ACTIVE (read-only board) until the
session is released (~45 s grace, same-token recovery). Controls are still one
button + Pause/Resume/End. The admin screen shows a live scoreboard (round,
players, answers, rankings) from the same server state — no refresh.

## Book assets
Every book: `title, author, authors, genre, year, isbn, edition, coverUrl (+S/M/L),
openLibraryUrl, interestingFact, whyInteresting`. All 17 covers are real published
editions from Open Library (ISBN-verified, 17/17 return images over HTTP); the
Cover component retries once, then shows a clean editorial fallback — never
generated art. Challenge books render in uniform 2-column tiles that fit the
viewport; Round 9 is a visual shelf puzzle (cover cards + slots + order strips).

## Sessions
Token sessions (`lib-me-v2`): refresh/disconnect rebinds the same player, keeps score,
never duplicates. Active name clashes get suffixes. Admin refresh never stops timers.

## Visual identity
Warm paper, ink black, oxblood, olive, brass. Playfair Display + Inter only.
Catalogue slips, spine-accented ranking wall, graphic per-book covers, tap-to-flip
discovery collectible. Main screen shows titles only during play; facts live on phones.
