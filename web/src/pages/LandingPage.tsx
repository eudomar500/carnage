import type { MouseEvent } from "react";
import TopNav, { type NavShell } from "../components/TopNav";
import JudgeTrex from "../components/JudgeTrex";
import HowItWorks from "../components/HowItWorks";
import Rubric from "../components/Rubric";
import Replay from "../components/Replay";
import Benchmark from "../components/Benchmark";
import Blog from "../components/Blog";
import { hrefFor } from "../lib/route";

export type LandingPageProps = {
  nav: NavShell;
  onOpenPost: (slug: string) => void;
};

/**
 * The presentation page.
 *
 * Reads nothing from the chain and holds no match state: it exists to say what
 * Carnage is and to hand you to the app. The reference sections render with no
 * match, which is their documentation form.
 *
 * The judge appears here and in the app for different reasons. Here it is the
 * brand image and it is always calm. In the app its mood is derived from live
 * match state and it is the status display.
 */
export default function LandingPage({ nav, onOpenPost }: LandingPageProps) {
  const launch = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    nav.onLaunch();
  };
  const appHref = hrefFor({ view: "app", matchId: null });

  return (
    <div className="stage" id="top">
      <TopNav variant="landing" {...nav} />

      <main className="lander">
        <div className="badge badge--justice">
          <div className="badge-title">
            ON-CHAIN JUSTICE
            <span className="badge-dots"><i /><i /></span>
          </div>
          <div className="badge-sub">Built on GenLayer</div>
        </div>

        <JudgeTrex mood="calm" strikeKey={0} />

        <div className="lander-center">
          <h1 className="wordmark">CARNAGE</h1>
          <p className="tagline">Where agents lie, and the jury bites back.</p>
          <p className="subtitle">
            Adversarial negotiation. Cryptographic commitments.
            <br />
            Claims judged against evidence. Economic consequences.
          </p>
          <a className="lander-cta" href={appHref} onClick={launch}>LAUNCH APP</a>
          <p className="lander-cta-note">
            Create a match, or open one by id. A wallet is needed to play a
            seat, not to watch.
          </p>
        </div>
      </main>

      <section className="lander-intro">
        <p className="lander-lede">
          Two agents negotiate a deal under private constraints they each
          committed to before speaking. They make natural-language claims to
          move the price their way, then reveal what they had committed to. An
          AI jury classifies each claim against that revealed evidence, and the
          verdict moves the GEN both sides staked. Two seats, Holder and Buyer,
          each held by a wallet: the matches on the record were played by
          people, a program can take a seat with no contract change, and the
          jury is the only AI in the system. The lie is the gap between the
          binding commitment and the claim: verifying the commitment is
          deterministic, judging the claim is semantic, and Carnage never lets
          those two blur.
        </p>

        <div className="layer-grid">
          <div className="layer">
            <div className="layer-key">CRYPTOGRAPHY</div>
            <p>
              What did the agent commit to? A salted hash, posted before any
              claim is made, that the contract later recomputes and checks.
            </p>
          </div>
          <div className="layer">
            <div className="layer-key">SMART CONTRACT</div>
            <p>
              Was the commitment, the reveal, the claim and the deal valid, and
              who gets paid or slashed? Deliberately boring, and excellent at
              deterministic things.
            </p>
          </div>
          <div className="layer layer--gen">
            <div className="layer-key">GENLAYER</div>
            <p>
              What does the natural-language claim mean relative to the
              committed evidence? The one thing deterministic code cannot do,
              and it sits on the critical path of settlement.
            </p>
          </div>
        </div>
      </section>

      <HowItWorks match={null} />
      <Rubric match={null} />
      <Replay match={null} />
      <Benchmark onOpenLab={nav.onOpenLab} />
      <Blog onOpenPost={onOpenPost} />

      <p className="thesis">
        CRYPTOGRAPHY ESTABLISHES WHAT EACH SIDE COMMITTED TO.
        <span className="thesis-sep">//</span>
        <span className="thesis-gen">GENLAYER</span> ESTABLISHES WHAT THEIR NATURAL-LANGUAGE CLAIMS MEAN.
      </p>

      <div className="lander-foot">
        <a className="lander-cta lander-cta--small" href={appHref} onClick={launch}>LAUNCH APP</a>
      </div>
    </div>
  );
}
