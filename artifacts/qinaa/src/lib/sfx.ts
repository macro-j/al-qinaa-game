/**
 * Shared sound-effects layer for the non-narrator cues (card flip, role reveal,
 * tension heartbeat).
 *
 * These are intentionally kept separate from the narrator engine in App.tsx:
 * the narrator is a single-cue model (one clip at a time — a new cue stops the
 * previous one), whereas these SFX must *overlap* the narrator without
 * interrupting it (and the heartbeat must loop). They also fire from component
 * trees that sit outside <App> (the Shop modal is mounted by <ShopProvider>),
 * so a module-level helper is the clean way to reach all call sites.
 *
 * This uses plain HTMLAudioElement — the same primitive the narrator uses — and
 * does NOT create a Web Audio context. This layer is independent of the
 * narrator voice-over mute toggle in App.tsx — card / heartbeat cues always
 * play unless individually gated elsewhere.
 */

const cache = new Map<string, HTMLAudioElement>();
let muted = false;
let heartbeat: HTMLAudioElement | null = null;

const SFX_FILES = ["card_flip.mp3", "role_reveal.mp3", "heartbeat_timer.mp3"];

function getEl(file: string): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  let a = cache.get(file);
  if (!a) {
    a = new Audio("/audio/" + file);
    a.preload = "auto";
    cache.set(file, a);
  }
  return a;
}

/** Warm the SFX cache. Called from App's existing audio-preload effect. */
export function preloadSfx(): void {
  SFX_FILES.forEach(getEl);
}

/** Re-load cached elements on first user gesture (iOS media-pipeline warmup). */
export function unlockSfx(): void {
  cache.forEach((a) => {
    try {
      a.load();
    } catch {
      /* ignored — best-effort unlock */
    }
  });
}

/** Mirror the app's mute toggle. Muting also stops any active heartbeat loop. */
export function setSfxMuted(value: boolean): void {
  muted = value;
  if (muted) stopHeartbeat();
}

/**
 * Fire a one-shot SFX. Plays on a clone so overlapping triggers (and the
 * narrator) never cut each other off.
 */
export function playSfx(file: string): void {
  if (muted) return;
  const base = getEl(file);
  if (!base) return;
  const node = base.cloneNode(true) as HTMLAudioElement;
  node.currentTime = 0;
  node.play().catch(() => {});
}

/** Start the looping tension heartbeat. Idempotent while already playing. */
export function startHeartbeat(): void {
  if (muted || heartbeat) return;
  const base = getEl("heartbeat_timer.mp3");
  if (!base) return;
  const node = base.cloneNode(true) as HTMLAudioElement;
  node.loop = true;
  node.currentTime = 0;
  heartbeat = node;
  node.play().catch(() => {});
}

/** Stop and clear the heartbeat loop. Safe to call when nothing is playing. */
export function stopHeartbeat(): void {
  if (!heartbeat) return;
  heartbeat.pause();
  heartbeat.currentTime = 0;
  heartbeat = null;
}
