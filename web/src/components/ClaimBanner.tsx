/**
 * Header banner for the judge stress-test article.
 *
 * Schematic rather than decorative, and it says something true about the
 * protocol: a claim written in natural language on one side, the commitment
 * that was sealed before it was written on the other, and a jury of
 * independent validators above the fulcrum. The beam tilts toward the
 * evidence, because in Carnage the evidence is what settles the argument.
 *
 * Drawn inline as vector, with no external files and no logos. Colours come
 * from the stylesheet variables so the banner tracks the palette instead of
 * pinning its own hexes: crimson for the judge, green for what is recorded
 * on-chain, steel for the untrusted text being weighed.
 *
 * Five validator marks is not an arbitrary count. Bradbury's chain definition
 * sets defaultNumberOfInitialValidators to 5.
 */

/** Beam geometry. The tilt is 5 degrees about the fulcrum at (600, 150). */
const LEFT = { x: 341, y: 127 };
const RIGHT = { x: 859, y: 173 };
const HANG = 40;
const BLOCK_W = 190;
const BLOCK_H = 80;

const VALIDATORS = [480, 540, 600, 660, 720];

export default function ClaimBanner() {
  const leftTop = LEFT.y + HANG;
  const rightTop = RIGHT.y + HANG;

  return (
    <div className="banner">
      <svg
        className="banner-svg"
        viewBox="0 0 1200 340"
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby="banner-title"
      >
        <title id="banner-title">
          A balance weighing a natural-language claim against a sealed
          commitment, with a jury of validators above the fulcrum.
        </title>

        <defs>
          <radialGradient id="banner-glow" cx="50%" cy="34%" r="62%">
            <stop offset="0%" stopColor="var(--crimson)" stopOpacity="0.20" />
            <stop offset="55%" stopColor="var(--crimson-deep)" stopOpacity="0.06" />
            <stop offset="100%" stopColor="var(--obsidian)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="1200" height="340" fill="var(--obsidian)" />
        <rect width="1200" height="340" fill="url(#banner-glow)" />

        {/* jury */}
        <text
          x="600" y="34" textAnchor="middle"
          className="banner-label banner-label--jury"
        >
          AI JURY
        </text>
        {VALIDATORS.map((x) => (
          <g key={x}>
            <line
              x1={x} y1="62" x2="600" y2="146"
              stroke="var(--crimson)" strokeOpacity="0.22" strokeWidth="1"
            />
            <rect
              x={x - 5} y="52" width="10" height="10"
              transform={`rotate(45 ${x} 57)`}
              fill="var(--obsidian)" stroke="var(--crimson)" strokeWidth="1.4"
            />
          </g>
        ))}

        {/* beam, tilted toward the evidence */}
        <line
          x1={LEFT.x} y1={LEFT.y} x2={RIGHT.x} y2={RIGHT.y}
          stroke="var(--crimson)" strokeWidth="2.5" strokeLinecap="square"
        />
        <circle cx="600" cy="150" r="5" fill="var(--crimson)" />

        {/* fulcrum */}
        <path
          d="M 600 150 L 572 226 L 628 226 Z"
          fill="none" stroke="var(--crimson)" strokeOpacity="0.65" strokeWidth="1.5"
        />
        <line
          x1="524" y1="226" x2="676" y2="226"
          stroke="var(--crimson)" strokeOpacity="0.65" strokeWidth="1.5"
        />

        {/* the claim: untrusted natural language */}
        <line
          x1={LEFT.x} y1={LEFT.y} x2={LEFT.x} y2={leftTop}
          stroke="var(--steel)" strokeWidth="1"
        />
        <g transform={`translate(${LEFT.x - BLOCK_W / 2} ${leftTop})`}>
          <rect
            width={BLOCK_W} height={BLOCK_H}
            fill="var(--obsidian)" stroke="var(--steel-dim)" strokeWidth="1"
          />
          <text x="14" y="22" className="banner-label">CLAIM</text>
          <line x1="14" y1="40" x2="176" y2="40" stroke="var(--steel)" strokeWidth="3" />
          <line x1="14" y1="52" x2="150" y2="52" stroke="var(--steel)" strokeWidth="3" />
          <line x1="14" y1="64" x2="104" y2="64" stroke="var(--steel)" strokeWidth="3" />
        </g>

        {/* the evidence: sealed before the claim was written */}
        <line
          x1={RIGHT.x} y1={RIGHT.y} x2={RIGHT.x} y2={rightTop}
          stroke="var(--steel)" strokeWidth="1"
        />
        <g transform={`translate(${RIGHT.x - BLOCK_W / 2} ${rightTop})`}>
          <rect
            width={BLOCK_W} height={BLOCK_H}
            fill="var(--obsidian)" stroke="var(--green)" strokeOpacity="0.55" strokeWidth="1"
          />
          <text x="14" y="22" className="banner-label banner-label--green">COMMITTED</text>
          <text x="14" y="52" className="banner-formula">H(state || salt)</text>
        </g>
      </svg>
    </div>
  );
}
