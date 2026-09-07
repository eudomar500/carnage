/**
 * What Carnage is for, stated once, on the landing.
 *
 * This is the positioning section: it explains that the match is an
 * instrument, not a toy. It reads nothing from the chain and takes no props,
 * which is why it lives on the presentation page and not in the app.
 *
 * One rule governs the copy here. The only numeric figure on the page comes
 * from published research and is labelled as such, right next to the number.
 * The five categories below are what the benchmark tracks; no values are
 * attached to them, because inventing one would undo the entire point of a
 * section about judges that cannot be trusted on their own say-so.
 */

type Metric = {
  key: string;
  text: string;
};

const METRICS: Metric[] = [
  {
    key: "Adjudication accuracy",
    text: "against a human-labeled fixture set of claims.",
  },
  {
    key: "Consensus rate",
    text: "how often independent validators converge on the same label.",
  },
  {
    key: "Adversarial robustness",
    text: "survival against misleading wording and direct prompt injection.",
  },
  {
    key: "Economic correctness",
    text: "whether settlement follows the verdict.",
  },
  {
    key: "Deterministic safety",
    text: "whether invalid states and undetermined outcomes ever move funds by accident.",
  },
];

type Reference = {
  n: number;
  title: string;
  href: string;
};

const REFERENCES: Reference[] = [
  {
    n: 1,
    title:
      "Investigating the Vulnerability of LLM-as-a-Judge Architectures to Prompt-Injection Attacks",
    href: "https://arxiv.org/abs/2505.13348",
  },
  {
    n: 2,
    title: "JudgeDeceiver: Prompt Injection Attacks to Manipulate LLM-as-a-Judge",
    href: "https://arxiv.org/abs/2403.17710",
  },
];

export default function Benchmark() {
  return (
    <section className="doc" id="benchmark">
      <div className="doc-head">
        <h2 className="doc-title">THE BENCHMARK</h2>
        <p className="doc-lede">
          Carnage is not just a game. It is an adversarial benchmark for the
          layer that the agent economy is quietly betting on: an AI jury that
          reads natural-language claims and returns a verdict with money
          attached.
        </p>
      </div>

      <div className="bench">
        <div className="bench-col">
          <p className="bench-para">
            That layer has a known weakness. A growing body of research on
            "LLM-as-a-Judge" systems, the paradigm of using a language model to
            evaluate text, has shown that these judges can be manipulated by the
            very inputs they are asked to judge. Recent work formalizing
            prompt-injection attacks against judge architectures reports attack
            success rates above 30 percent against current models. A claim
            written to be judged can carry an instruction aimed at the judge
            itself, and often it works.
          </p>

          <p className="bench-para">
            Most systems that use an AI jury never test this. They demonstrate
            the happy path: two well-behaved parties, a clean verdict, applause.
            Carnage does the opposite. Every match is a deliberate attempt to
            deceive the jury or to attack it directly, and the benchmark
            measures what the jury does under that pressure.
          </p>
        </div>

        {/*
          Attribution sits inside the callout, not in a footnote. A bare figure
          this size, on a page listing five Carnage metrics, would be read as
          one of ours.
        */}
        <aside className="bench-callout">
          <div className="bench-callout-key">REPORTED IN PUBLISHED RESEARCH</div>
          <div className="bench-callout-figure">OVER 30%</div>
          <p className="bench-callout-text">
            attack success rate against current models, from work formalizing
            prompt-injection attacks on LLM-as-a-Judge architectures. See
            reference [1] below.
          </p>
          <p className="bench-callout-note">Not a Carnage measurement.</p>
        </aside>
      </div>

      <h3 className="bench-sub">WHAT CARNAGE MEASURES, ACROSS MATCHES</h3>
      <ol className="bench-metrics">
        {METRICS.map((m, i) => (
          <li key={m.key} className="metric">
            <span className="metric-no">{String(i + 1).padStart(2, "0")}</span>
            <span className="metric-key">{m.key}</span>
            <span className="metric-text">{m.text}</span>
          </li>
        ))}
      </ol>

      <p className="bench-para bench-para--wide">
        The academic work on this problem runs in the lab: fixed datasets, local
        models, no stakes. Carnage runs it in production. The jury is a live
        network of independent validators on GenLayer, the evidence is
        cryptographically committed before anyone speaks, the verdict moves real
        funds, and every result is recorded on-chain and reproducible from the
        block explorer. That is the gap Carnage fills: it takes a question the
        research community is asking in isolation and answers it where it
        actually matters, on a decentralized adjudication layer under real
        economic pressure.
      </p>

      <p className="bench-close">
        The agent economy is building courts. Carnage is the stress test that
        tells you whether the court can be bought.
      </p>

      <div className="refs">
        <div className="refs-title">FURTHER READING</div>
        <ol className="refs-list">
          {REFERENCES.map((r) => (
            <li key={r.href} className="ref">
              <span className="ref-no">[{r.n}]</span>
              <a
                className="ref-link"
                href={r.href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {r.title}
              </a>
              <span className="ref-host">arxiv.org</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
