import { isStrike, type JudgeMood } from "../chain/phase";
import { asset } from "../lib/asset";

/**
 * The central judge.
 *
 * `mood` is derived from live match state, never set by hand. Each mood drives
 * a different CSS animation on the portrait and on the red eye, which is a
 * separately-positioned glow anchored to the eye in the source image.
 *
 * Both frames of the portrait are mounted from the first paint, the open one
 * stacked over the closed one at zero opacity. That is what loads it: a frame
 * fetched at the moment the jaws open would flash a gap on the first roar, and
 * a hidden image costs one request on a page that is already fetching the
 * closed frame from the same directory.
 *
 * The pair sits in its own box so the vignette mask can be applied once, to
 * the two of them together. Masking each frame instead made the falloff add up
 * wherever both were painted, which is a dark ring around the head for the
 * length of a cross-fade.
 *
 * The judge holds the centre throughout. What a settlement sends at the losing
 * card is the shockwave, not the head.
 */
export default function JudgeTrex({ mood, strikeKey }: { mood: JudgeMood; strikeKey: number }) {
  return (
    <div className={`judge judge--${mood}`} key={isStrike(mood) ? strikeKey : undefined}>
      <span className="judge-frames">
        <img className="judge-img" src={asset("assets/trex-central.webp")} alt="" draggable={false} />
        <img
          className="judge-img judge-img--open"
          src={asset("assets/trex-central-open.webp")}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      </span>
      <span className="judge-eye" aria-hidden="true" />
      <span className="judge-eye-flare" aria-hidden="true" />
    </div>
  );
}
