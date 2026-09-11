import { LockClosed, LockOpen } from "./Icons";
import { formatToken, formatPrice, shortAddress, TOKEN_SYMBOL } from "../lib/format";
import { asset } from "../lib/asset";
import type { Label } from "../chain/contract";

const AVATAR = {
  HOLDER: asset("assets/holder-avatar.png"),
  BUYER: asset("assets/buyer-avatar.png"),
} as const;

export type AgentCardProps = {
  role: "HOLDER" | "BUYER";
  address: string;
  committed: boolean;
  revealed: boolean;
  /** minimum_price for the holder, maximum_budget for the buyer. */
  constraint: bigint;
  stake: bigint;
  label: Label;
  /** True once settlement slashed this side; the frame cracks. */
  cracked: boolean;
};

export default function AgentCard(p: AgentCardProps) {
  const isHolder = p.role === "HOLDER";
  const constraintKey = isHolder ? "minimum_price" : "maximum_budget";

  return (
    <section
      className={`card card--${isHolder ? "holder" : "buyer"}${p.cracked ? " card--cracked" : ""}`}
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

      <svg className="card-cracks" viewBox="0 0 240 520" preserveAspectRatio="none" aria-hidden="true">
        <path d="M120 0 L104 96 L138 172 L96 268 L130 352 L88 440 L112 520" />
        <path d="M104 96 L36 128 M138 172 L214 148 M96 268 L18 300 M130 352 L226 336 M88 440 L22 470" />
      </svg>
    </section>
  );
}
