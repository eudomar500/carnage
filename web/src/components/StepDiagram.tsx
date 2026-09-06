import { Document, Jury, LockClosed, LockOpen, Scales, Speech } from "./Icons";

const STEPS = [
  { key: "COMMIT", label: "COMMIT", venue: "HASH", Icon: LockClosed },
  { key: "NEGOTIATE", label: "NEGOTIATE", venue: "OFF-CHAIN", Icon: Speech },
  { key: "ANCHOR", label: "ANCHOR CLAIMS", venue: "ON-CHAIN", Icon: Document },
  { key: "REVEAL", label: "REVEAL", venue: "ON-CHAIN", Icon: LockOpen },
  { key: "JUDGE", label: "JUDGE", venue: "GENLAYER", Icon: Jury },
  { key: "SETTLE", label: "SETTLE", venue: "ON-CHAIN", Icon: Scales },
] as const;

/** Horizontal pipeline. `active` is the live phase index from get_match. */
export default function StepDiagram({ active }: { active: number }) {
  return (
    <ol className="steps">
      {STEPS.map((s, i) => {
        const state = i < active ? "done" : i === active ? "active" : "pending";
        return (
          <li key={s.key} className={`step step--${state}`}>
            <span className="step-label">{s.label}</span>
            <span className="step-icon">
              <s.Icon className="ico" />
            </span>
            <span className="step-venue">{s.venue}</span>
            {i < STEPS.length - 1 ? <span className="step-arrow" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
