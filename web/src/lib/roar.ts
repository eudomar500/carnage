import { asset } from "./asset";

/**
 * The judge's roar.
 *
 * The threat phase is a fixed 3000 ms and the file is cut to match, so nothing
 * here measures anything: the sound and the animation are two halves of the
 * same 3 seconds, and the only job of this module is to start the sound and to
 * stay out of the way when it cannot.
 *
 * Everything degrades to silence. A browser with no Audio, a refused autoplay,
 * a file that has not loaded and a reader who muted it all end in the same
 * place: no sound, and a threat that runs exactly as long as it would have.
 */

const SRC = "assets/judge-roar.mp3";
const MUTE_KEY = "carnage:muted";

let el: HTMLAudioElement | null = null;

function element(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (el) return el;

  el = new Audio(asset(SRC));
  // Fetched with the portrait frames rather than at the moment of the
  // settlement, which is the one moment there is no time to wait for it.
  el.preload = "auto";
  return el;
}

/** Starts the fetch. Safe to call on every mount; the element is made once. */
export function preloadRoar(): void {
  element();
}

export function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    // Private windows and blocked storage both mean "no preference stored".
    return false;
  }
}

export function writeMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // A preference that cannot be stored is still worth honouring this visit.
  }
}

/**
 * Plays the roar once, from the top.
 *
 * Nothing waits on it. A browser that has seen no user gesture rejects play(),
 * and the rejection is swallowed here because the visual sequence carries the
 * verdict on its own and must not be held up by a sound it may never get.
 */
export function playRoar(muted: boolean): void {
  if (muted) return;

  const audio = element();
  if (!audio) return;

  try {
    audio.currentTime = 0;
    const started = audio.play();
    if (started && typeof started.catch === "function") started.catch(() => {});
  } catch {
    // Some engines throw synchronously instead of rejecting. Same outcome.
  }
}
