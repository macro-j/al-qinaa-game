---
name: qinaa typecheck baseline
description: Pre-existing, intentional typecheck errors in the qinaa game + api-server that must not grow
---

# qinaa / api-server known typecheck baseline

`artifacts/qinaa` typechecks with **exactly 7 pre-existing errors**, all in `src/App.tsx`
and all from the unfinished **online multiplayer mode** (ReactNode import, and
`isAlive`/`isHost` on union types around the online-game state). `artifacts/api-server`
has **exactly 3** pre-existing errors in `src/index.ts` (`activeGamePhase`).

**Why:** Online mode is a work-in-progress that is currently gated off (the online
mode button is rendered behind `{false && ...}` in `GameModeSelector`). These errors
predate current work and are tolerated, not bugs to fix ad hoc.

**How to apply:** After any edit to qinaa, run `pnpm --filter @workspace/qinaa run typecheck`
and confirm the count is still 7 (api-server: 3). Any number above baseline means your
change introduced a regression — fix it. Do not "fix" the baseline errors themselves
unless explicitly asked, and never touch gameplay logic (shuffle/audio/voting/timers/night).
