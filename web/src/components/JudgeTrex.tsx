import { isStrike, type JudgeMood } from "../chain/phase";
import { asset } from "../lib/asset";

/**
 * The central judge.
 *
 * `mood` is derived from live match state, never set by hand. Each mood drives
 * a different CSS animation on the portrait and on the red eye, which is a
 * separately-positioned glow anchored to the eye in the source image.
 */
export default function JudgeTrex({ mood, strikeKey }: { mood: JudgeMood; strikeKey: number }) {
  return (
    <div className={`judge judge--${mood}`} key={isStrike(mood) ? strikeKey : undefined}>
      <img className="judge-img" src={asset("assets/trex-central.webp")} alt="" draggable={false} />
      <span className="judge-eye" aria-hidden="true" />
      <span className="judge-eye-flare" aria-hidden="true" />
    </div>
  );
}
