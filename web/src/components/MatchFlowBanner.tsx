/**
 * Header banner for the plain-language walkthrough.
 *
 * The article walks a match from the sealed envelope to the payout, so the
 * banner is that same line: six beats on one track, in order, left to right.
 * Three of them get something above the line, because those are the three
 * ideas the article is actually about. The sealed commitment, which is made
 * before anyone speaks. The claim, which is free text and is where the whole
 * game lives. The jury, which is a panel rather than a single node.
 *
 * Drawn inline as vector, with no external files and no logos. Colours come
 * from the stylesheet variables, so the banner tracks the palette: green for
 * what cryptography can prove, steel for untrusted text, crimson for the
 * judge and the money it moves.
 *
 * Five validator marks is not an arbitrary count. Bradbury's chain definition
 * sets defaultNumberOfInitialValidators to 5.
 */

/** Track geometry. Six evenly spaced beats on one line. */
const TRACK_Y = 208;
const FIRST_X = 140;
const STEP = 188;
const BEATS = ["SEAL", "STAKE", "CLAIM", "REVEAL", "JURY", "SETTLE"];
const UNDER = [
  "commit a secret",
  "GEN in escrow",
  "write anything",
  "hash checked",
  "five validators",
  "GEN follows",
];

const beatX = (i: number) => FIRST_X + i * STEP;

const VALIDATORS = [-56, -28, 0, 28, 56];

export default function MatchFlowBanner() {
  const sealX = beatX(0);
  const claimX = beatX(2);
  const juryX = beatX(4);

  return (
    <div className="banner">
      <svg
        className="banner-svg"
        viewBox="0 0 1200 340"
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby="flow-banner-title"
      >
        <title id="flow-banner-title">
          One match end to end: seal a secret, stake, write a claim, reveal,
          face a jury of five validators, and settle.
        </title>

        <defs>
          <radialGradient id="flow-banner-glow" cx="50%" cy="38%" r="64%">
            <stop offset="0%" stopColor="var(--crimson)" stopOpacity="0.18" />
            <stop offset="55%" stopColor="var(--crimson-deep)" stopOpacity="0.05" />
            <stop offset="100%" stopColor="var(--obsidian)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="1200" height="340" fill="var(--obsidian)" />
        <rect width="1200" height="340" fill="url(#flow-banner-glow)" />

        <text
          x="600" y="36" textAnchor="middle"
          className="banner-label banner-label--jury"
        >
          ONE MATCH, END TO END
        </text>

        {/* the track every beat sits on */}
        <line
          x1={FIRST_X} y1={TRACK_Y} x2={beatX(5)} y2={TRACK_Y}
          stroke="var(--steel-dim)" strokeWidth="1.5"
        />

        {/* the sealed commitment, made before anyone speaks */}
        <line
          x1={sealX} y1="150" x2={sealX} y2={TRACK_Y - 12}
          stroke="var(--green)" strokeOpacity="0.4" strokeWidth="1"
        />
        <g transform={`translate(${sealX - 46} 108)`}>
          <rect
            width="92" height="58"
            fill="var(--obsidian)" stroke="var(--green)" strokeOpacity="0.6" strokeWidth="1.2"
          />
          <path
            d="M 0 0 L 46 34 L 92 0"
            fill="none" stroke="var(--green)" strokeOpacity="0.6" strokeWidth="1.2"
          />
        </g>

        {/* the claim: free text, and the reason the game is a game */}
        <line
          x1={claimX} y1="150" x2={claimX} y2={TRACK_Y - 12}
          stroke="var(--steel)" strokeOpacity="0.5" strokeWidth="1"
        />
        <g transform={`translate(${claimX - 80} 92)`}>
          <rect
            width="160" height="74"
            fill="var(--obsidian)" stroke="var(--steel-dim)" strokeWidth="1"
          />
          <text x="12" y="22" className="banner-label">FREE TEXT</text>
          <line x1="12" y1="40" x2="148" y2="40" stroke="var(--steel)" strokeWidth="3" />
          <line x1="12" y1="52" x2="126" y2="52" stroke="var(--steel)" strokeWidth="3" />
          <line x1="12" y1="64" x2="92" y2="64" stroke="var(--steel)" strokeWidth="3" />
        </g>

        {/* the jury: a panel, not a node */}
        {VALIDATORS.map((dx) => (
          <g key={dx}>
            <line
              x1={juryX + dx} y1="126" x2={juryX} y2={TRACK_Y - 12}
              stroke="var(--crimson)" strokeOpacity="0.22" strokeWidth="1"
            />
            <rect
              x={juryX + dx - 5} y="116" width="10" height="10"
              transform={`rotate(45 ${juryX + dx} 121)`}
              fill="var(--obsidian)" stroke="var(--crimson)" strokeWidth="1.4"
            />
          </g>
        ))}

        {/* the beats themselves */}
        {BEATS.map((label, i) => {
          const x = beatX(i);
          const last = i === BEATS.length - 1;
          return (
            <g key={label}>
              <circle
                cx={x} cy={TRACK_Y} r="9"
                fill="var(--obsidian)"
                stroke={last ? "var(--crimson)" : "var(--steel)"}
                strokeWidth={last ? "2" : "1.4"}
              />
              {last ? <circle cx={x} cy={TRACK_Y} r="3.5" fill="var(--crimson)" /> : null}
              <text
                x={x} y={TRACK_Y + 42} textAnchor="middle"
                className={`banner-label${last ? " banner-label--jury" : ""}`}
              >
                {label}
              </text>
              <text
                x={x} y={TRACK_Y + 66} textAnchor="middle"
                className="banner-sub"
              >
                {UNDER[i]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
