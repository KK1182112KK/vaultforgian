import { useEffect } from "react";

const heroMeta = [
  "Desktop Obsidian plugin",
  "Approval-first note edits",
  "Evidence-backed rewrites",
] as const;

const productFlow = [
  "Answer in context",
  "Reflect in note",
  "Review the patch",
] as const;

const proofPoints = [
  {
    label: "Evidence references",
    body: "Patch summaries carry visible citation markers like [1][2] instead of hiding where the rewrite came from.",
  },
  {
    label: "Explicit diff surface",
    body: "The user sees the note change as a patch proposal before anything touches the vault.",
  },
  {
    label: "Human approval remains central",
    body: "The product helps Codex improve notes without asking the user to trust silent background edits.",
  },
] as const;

const requirements = [
  "Obsidian desktop",
  "Codex CLI installed",
  "codex login completed",
  "Windows supported through WSL",
] as const;

export default function App() {
  useEffect(() => {
    const revealTargets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      {
        threshold: 0.2,
        rootMargin: "0px 0px -10% 0px",
      },
    );
    revealTargets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="page-shell">
      <div className="page-glow page-glow-a" aria-hidden="true" />
      <div className="page-glow page-glow-b" aria-hidden="true" />

      <section className="hero-band">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              <span />
              <span />
            </div>
            <div>
              <p className="brand-kicker">Codex for serious note work</p>
              <h1>Codex Noteforge</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <a className="text-link" href="#requirements">
              Requirements
            </a>
            <a
              className="text-link"
              href="https://github.com/KK1182112KK/codex-noteforge"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
        </header>

        <div className="hero-grid">
          <div className="hero-copy hero-enter">
            <p className="eyebrow">Built with Codex for students, notes, papers, and lecture workflows</p>
            <h2>Study with Codex directly inside your notes and sources.</h2>
            <p className="hero-body">
              Ask about a lecture, paper, homework set, or note inside Obsidian, then turn the answer into a
              reviewable note patch without leaving your vault.
            </p>
            <div className="hero-actions">
              <a className="primary-cta" href="#product">
                Watch demo
              </a>
              <a
                className="secondary-cta"
                href="https://github.com/KK1182112KK/codex-noteforge"
                target="_blank"
                rel="noreferrer"
              >
                View on GitHub
              </a>
            </div>
            <div className="hero-meta">
              {heroMeta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>

          <div className="hero-display hero-enter-delayed" aria-hidden="true">
            <div className="display-orbit orbit-a" />
            <div className="display-orbit orbit-b" />

            <article className="display-plane">
              <div className="display-header">
                <span />
                <span />
                <span />
              </div>

              <div className="display-toolbar">
                <div className="display-brand">
                  <strong>Codex Noteforge</strong>
                  <span>Study with Codex inside Obsidian</span>
                </div>
                <div className="display-tags">
                  <span>Answer in context</span>
                  <span>Reflect in note</span>
                  <span>Reviewable patch</span>
                </div>
              </div>

              <div className="display-body">
                <div className="display-chat">
                  <div className="chat-row user">
                    <div className="avatar-pill user-avatar">You</div>
                    <div className="bubble">
                      Summarize the key equations from this lecture and make the note easier to revise from later.
                    </div>
                  </div>
                  <div className="chat-row assistant">
                    <div className="avatar-pill assistant-avatar">CN</div>
                    <div className="bubble">
                      I tightened the explanation around the governing equations and normalized the notation so the note
                      scans faster before an exam.
                      <div className="reflect-strip">
                        <span>Want me to reflect this in the note?</span>
                        <button type="button">Reflect in note</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="display-proof">
                  <div className="proof-kicker-line">
                    <span>Reviewable patch</span>
                    <span className="badge">Web-backed</span>
                  </div>
                  <p className="proof-summary">
                    Normalize LaTeX notation and tighten headings.<span>[1]</span>
                    <span>[2]</span>
                  </p>
                  <div className="mini-citations">
                    <div>[1] Lecture 15</div>
                    <div>[2] NIST reference</div>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <main className="page-main">
        <section className="section problem-section reveal-up" data-reveal>
          <div className="section-heading problem-heading">
            <p className="eyebrow">Problem</p>
            <h3>AI can rewrite notes, but you cannot trust silent edits.</h3>
            <p className="section-body">
              The risk is not that AI can improve a note. The risk is that the improvement happens invisibly, without a
              review surface, without evidence, and without a clear approval step.
            </p>
          </div>

          <div className="problem-contrast">
            <article className="problem-panel before-panel">
              <div className="problem-panel-header">
                <span>Before</span>
                <strong>Silent overwrite</strong>
              </div>
              <div className="problem-surface muted-surface">
                <div className="muted-line w-84" />
                <div className="muted-line w-71" />
                <div className="muted-line w-92" />
                <div className="muted-warning">Rewritten in the background. Source unclear.</div>
              </div>
            </article>

            <article className="problem-panel after-panel">
              <div className="problem-panel-header">
                <span>After</span>
                <strong>Visible rewrite</strong>
              </div>
              <div className="problem-surface visible-surface">
                <div className="visible-summary">
                  Reviewable patch with explicit evidence.<span>[1]</span>
                  <span>[2]</span>
                </div>
                <div className="visible-evidence">[1] Lecture note</div>
                <div className="visible-evidence">[2] External reference</div>
                <div className="visible-actions">
                  <button type="button">Reject</button>
                  <button type="button">Apply</button>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className="section product-section reveal-up" data-reveal id="product">
          <div className="section-heading">
            <p className="eyebrow">Product</p>
            <h3>Answer {"->"} Reflect in note {"->"} Patch</h3>
            <p className="section-body">
              The answer does not stop at chat. It becomes a visible note-improvement flow inside the same workspace,
              with one continuous surface instead of disconnected tools.
            </p>
          </div>

          <div className="product-shell">
            <div className="product-ribbon">
              {productFlow.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>

            <div className="product-canvas">
              <div className="product-stage answer-stage">
                <div className="stage-label">Answer</div>
                <div className="stage-window">
                  <div className="stage-window-header">Codex answer in context</div>
                  <p>
                    The explanation is shaped for the current lecture note, not for a generic chat thread detached from
                    the source.
                  </p>
                </div>
              </div>

              <div className="product-bridge">
                <div className="bridge-pill">Want me to reflect this in the note?</div>
                <div className="bridge-arrow" aria-hidden="true">
                  <span />
                  <span />
                </div>
              </div>

              <div className="product-stage patch-stage">
                <div className="stage-label">Patch</div>
                <div className="stage-window patch-window">
                  <div className="patch-window-header">
                    <strong>Lecture 15 note rewrite</strong>
                    <span>Web-backed</span>
                  </div>
                  <div className="patch-window-summary">
                    Normalize LaTeX notation and tighten headings.<span>[1]</span>
                    <span>[2]</span>
                  </div>
                  <pre>{`@@ Core Equations @@
+ $$\\oint_C \\mathbf{E}\\cdot d\\mathbf{l} = -\\frac{d}{dt}\\int_S \\mathbf{B}\\cdot d\\mathbf{s}$$`}</pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section proof-section reveal-up" data-reveal>
          <div className="proof-grid">
            <div className="section-heading proof-heading">
              <p className="eyebrow">Proof</p>
              <h3>The proof is visible in the patch itself.</h3>
              <p className="section-body">
                Trust does not come from marketing copy. It comes from the patch card: explicit evidence markers,
                explicit diff, and an explicit approval action.
              </p>

              <div className="proof-points">
                {proofPoints.map((item) => (
                  <div className="proof-point" key={item.label}>
                    <strong>{item.label}</strong>
                    <p>{item.body}</p>
                  </div>
                ))}
              </div>
            </div>

            <article className="proof-card">
              <div className="proof-card-topline">
                <div>
                  <p className="proof-card-kicker">Evidence-backed patch</p>
                  <h4>Lecture 15 note rewrite</h4>
                </div>
                <span className="badge">Web-backed</span>
              </div>

              <p className="proof-card-summary">
                Normalize LaTeX notation and tighten headings.<span>[1]</span>
                <span>[2]</span>
              </p>

              <div className="citation-list">
                <div className="citation-row">
                  <strong>[1]</strong>
                  <span>Lecture 15: “Faraday law is introduced in integral form.”</span>
                </div>
                <div className="citation-row">
                  <strong>[2]</strong>
                  <span>NIST reference: “Notation reference used to normalize symbols.”</span>
                </div>
              </div>

              <pre className="diff-block">
                <code>{`@@ Core Equations @@
+ $$\\oint_C \\mathbf{E}\\cdot d\\mathbf{l} = -\\frac{d}{dt}\\int_S \\mathbf{B}\\cdot d\\mathbf{s}$$
+ Added a short exam-facing interpretation under the equation.`}</code>
              </pre>

              <div className="proof-card-actions">
                <button type="button" className="ghost-btn">
                  Open note
                </button>
                <button type="button" className="ghost-btn">
                  Reject
                </button>
                <button type="button" className="solid-btn">
                  Apply patch
                </button>
              </div>
            </article>
          </div>
        </section>

        <section className="section requirements-section reveal-up" data-reveal id="requirements">
          <div className="section-heading narrow">
            <p className="eyebrow">Requirements</p>
            <h3>Keep setup visible, but out of the hero.</h3>
          </div>

          <div className="requirements-row">
            {requirements.map((item) => (
              <div className="requirement-token" key={item}>
                {item}
              </div>
            ))}
          </div>

          <p className="requirements-note">
            The plugin uses the official Codex CLI session. Install the CLI, run <code>codex login</code>, then open
            the workspace inside Obsidian.
          </p>
        </section>

        <section className="final-cta reveal-up" data-reveal>
          <div>
            <p className="eyebrow">Ready for the contest page</p>
            <h3>One page to explain the product before the demo loads.</h3>
          </div>
          <div className="hero-actions">
            <a className="primary-cta" href="#product">
              Watch demo
            </a>
            <a
              className="secondary-cta"
              href="https://github.com/KK1182112KK/codex-noteforge"
              target="_blank"
              rel="noreferrer"
            >
              View on GitHub
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
