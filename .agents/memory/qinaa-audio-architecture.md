---
name: qinaa audio architecture
description: Two distinct audio paths in qinaa (narrator single-cue vs overlapping SFX) and how/where to hook new sounds.
---

# Qinaa audio — two separate paths

There are TWO intentionally separate audio systems. Use the right one for the sound's behavior:

1. **Narrator engine** — in `App.tsx`: a preloaded `audioCache` (HTMLAudioElement map) + `playGameAudio(file)`. It is a SINGLE-CUE model: a new cue pauses/replaces `currentPlaying`. Gated by `isMuted`, warmed by a one-time `pointerdown` unlock. Use it ONLY for sounds that should be the dominant/sole clip (narrator lines, victory fanfares like mafia_win/town_win/**madman_win**). Add the file to the preload list array.

2. **SFX layer** — `src/lib/sfx.ts` (module-level, NOT a Web Audio context — plain HTMLAudioElement). Plays one-shots on `cloneNode` so they OVERLAP the narrator without interrupting it; `startHeartbeat`/`stopHeartbeat` manage a single looping element. App registers it (`preloadSfx()` in the preload effect, `unlockSfx()` in the unlock handler) and mirrors mute via `useEffect(() => setSfxMuted(isMuted), [isMuted])`. Use it for card_flip, role_reveal, heartbeat — sounds that must layer over narrator and/or loop.

**Why two paths:** the narrator's single-cue model cannot overlap or loop without cutting off narration. Also the Shop modal is mounted by `ShopProvider` OUTSIDE the `<App>` tree, so it cannot reach App's refs — a module-level SFX helper is the only clean way to fire the same flip sound from in-game, Guide (inside App), AND Shop (outside App).

## Event hook points
- **card_flip**: the in-game reveal card `onClick` (App.tsx introductory-night card) AND `RoleRevealCard.tsx` `onClick` (shared by Shop + Guide).
- **role_reveal**: fired alongside card_flip in the in-game introductory-night card `onClick`, guarded `if (isCardFlipped) return` so it fires once.
- **heartbeat (last 10s of voting/discussion only)**: lives inside the timer DISPLAY components, which already `setInterval` a `secs` tick. `DayTimerBar` (local pass-and-play) and `Countdown` (online) BOTH take an opt-in `heartbeat?: boolean` prop. Effect: `if (heartbeat && secs in (0,10]) startHeartbeat(); else stopHeartbeat();` deps `[heartbeat, secs]`, plus `useEffect(()=>()=>stopHeartbeat(),[])` for unmount. CRITICAL: the online `Countdown`'s `phaseEndsAt` is emitted for NIGHT phases too — so callers MUST gate the prop to `gamePhase/activeGamePhase === "day_discussion" || "voting"`, else heartbeat leaks into night. Putting `heartbeat` in the dep array makes it stop on phase change even without unmount.
- **madman_win**: just `playGameAudio("madman_win.mp3")` in the game-over victory effect (`phase==="game_over" && gameOver.winner==="madman"`). The instant-execution madman path (`handleExecute`) sets `phase="game_over"` + winner, so the SAME effect fires — no separate call needed at the execution site.

**No infinite re-render rule:** these audio effects/handlers call only the audio side-effect functions (never React setState), so they never trigger re-renders. `startHeartbeat` is idempotent (no restart while already looping).
