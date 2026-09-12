import type { CSSProperties } from "react";
import { LockClosed, LockOpen } from "./Icons";
import { formatToken, formatPrice, shortAddress, TOKEN_SYMBOL } from "../lib/format";
import { asset } from "../lib/asset";
import type { Label } from "../chain/contract";

const AVATAR = {
  HOLDER: asset("assets/holder-avatar.png"),
  BUYER: asset("assets/buyer-avatar.png"),
} as const;

/*
 * The fracture, drawn once in the card's own 240 by 520 viewBox and stretched
 * to whatever the card measures (preserveAspectRatio is none).
 *
 * It was laid out against the card's vertical rhythm rather than freehand. In
 * viewBox units the role sits around y 21 to 50, the agent line 52 to 69, the
 * avatar 86 to 234, the commitment field 252 to 303, the constraint value 313
 * to 367, the stake 391 to 435 and the verdict band below 445. So the crack
 * enters at the near edge at y 150, beside the avatar, crosses the avatar
 * itself, which is an image and can take it, and runs out through the gap
 * under it at y 238 to 246. It never reaches the constraint, the stake or the
 * verdict: those are the numbers and the label, and a crack over them costs
 * the reader more than it buys.
 *
 * The buyer's card is the same path mirrored in CSS, because its near edge is
 * the other one.
 */
const CRACK_MAIN = "M240 150 L196 168 L168 196 L140 186 L118 214 L86 206 L58 238 L18 246";
const CRACK_BRANCHES =
  "M168 196 L200 120 L214 96 M118 214 L104 248 M58 238 L30 262 L10 258";

/*
 * Embers leave from points on those lines, in fractions of the card, so they
 * rise out of the crack rather than off the card's face. Ten of them, each
 * with its own delay so they do not leave as a row.
 */
const EMBERS: { x: string; y: string; drift: string; delay: string }[] = [
  { x: "96%", y: "29%", drift: "-7px", delay: "0ms" },
  { x: "88%", y: "31%", drift: "5px", delay: "70ms" },
  { x: "78%", y: "26%", drift: "-4px", delay: "140ms" },
  { x: "70%", y: "38%", drift: "8px", delay: "40ms" },
  { x: "58%", y: "36%", drift: "-6px", delay: "180ms" },
  { x: "49%", y: "41%", drift: "4px", delay: "100ms" },
  { x: "38%", y: "40%", drift: "-5px", delay: "220ms" },
  { x: "27%", y: "45%", drift: "6px", delay: "60ms" },
  { x: "16%", y: "46%", drift: "-8px", delay: "160ms" },
  { x: "8%", y: "47%", drift: "3px", delay: "260ms" },
];

export type AgentCardProps = {
  role: "HOLDER" | "BUYER";
  address: string;
  committed: boolean;
  revealed: boolean;
  /** minimum_price for the holder, maximum_budget for the buyer. */
  constraint: bigint;
  stake: bigint;
  label: Label;
  /** True once settlement slashed this side; the card rests cracked. */
  cracked: boolean;
  /** True only while the shockwave is landing on this card. */
  impact?: boolean;
};

export default function AgentCard(p: AgentCardProps) {
  const isHolder = p.role === "HOLDER";
  const constraintKey = isHolder ? "minimum_price" : "maximum_budget";

  return (
    <section
      className={
        `card card--${isHolder ? "holder" : "buyer"}` +
        (p.cracked ? " card--cracked" : "") +
        (p.impact ? " card--impact" : "")
      }
    >
      <div className="card-corner card-corner--tl" />
      <div className="card-corner card-corner--tr" />
      <div className="card-corner card-corner--bl" />
      <div className="card-corner card-corner--br" />

      <h2 className="card-role">{p.role}</h2>
      <p className="card-agent">Agent {shortAddress(p.address, 2, 4)}</p>

      <div className="octagon">
        <img src={AVATAR[p.role]} alt={`${p.role} agent`} />
        <span className="octagon-ring" aria-hidden="true" />
      </div>

      <div className="field">
        <div className="field-head">
          {p.revealed ? <LockOpen className="ico" /> : <LockClosed className="ico" />}
          <span className="field-title">COMMITMENT</span>
        </div>
        <div className="field-mono">
          {p.committed ? (p.revealed ? "VERIFIED ON-CHAIN" : "SEALED: HASH ANCHORED") : "NOT COMMITTED"}
        </div>
      </div>

      <div className="field">
        <div className="field-label">{constraintKey}</div>
        <div className={`field-value${p.revealed ? "" : " field-value--sealed"}`}>
          {p.revealed ? formatPrice(p.constraint) : "SEALED"}
        </div>
      </div>

      <div className="field field--stake">
        <div className="field-label">STAKE</div>
        <div className="field-stake">
          {formatToken(p.stake)} <span className="unit">{TOKEN_SYMBOL}</span>
        </div>
      </div>

      {p.label ? (
        <div className={`card-verdict card-verdict--${p.label.toLowerCase()}`}>{p.label}</div>
      ) : null}

      {/*
        * Two plates of the surface, clipped along the crack lines and nudged
        * off true. They are tints rather than copies of the card, so the text
        * underneath stays where it is and stays readable; what moves is the
        * shading, which is what makes the face read as broken rather than
        * drawn on.
        */}
      <span className="card-shard card-shard--a" aria-hidden="true" />
      <span className="card-shard card-shard--b" aria-hidden="true" />

      <svg className="card-cracks" viewBox="0 0 240 520" preserveAspectRatio="none" aria-hidden="true">
        <path className="card-crack-line" d={CRACK_MAIN} />
        <path className="card-crack-line" d={CRACK_BRANCHES} />
      </svg>

      {p.impact ? (
        <span className="card-embers" aria-hidden="true">
          {EMBERS.map((e) => (
            <span
              key={`${e.x}-${e.y}`}
              className="ember"
              style={
                {
                  left: e.x,
                  top: e.y,
                  "--drift": e.drift,
                  animationDelay: e.delay,
                } as CSSProperties
              }
            />
          ))}
        </span>
      ) : null}
    </section>
  );
}
