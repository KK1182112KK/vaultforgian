import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { DEMO_CHAPTERS, DEMO_RECORDING_PUBLIC_PATH } from "./remotion/demoConfig";

const DemoPlayer = lazy(() => import("./remotion/DemoPlayer").then((module) => ({ default: module.DemoPlayer })));

const navIcon = "/brand/noteforge-icon-180.png";
const forgeVisual = "/brand/noteforge-forge-visual.png";
const learningModeVideo = "/demo/noteforge-learning-mode.mp4";
const repoUrl = "https://github.com/KK1182112KK/vaultforgian";
const releaseUrl = "https://github.com/KK1182112KK/vaultforgian/releases/latest";

const heroSignals = [
  "Clean demo vault",
  "Diff-gated writes",
  "Codex CLI session",
] as const;

const workflowSteps = [
  {
    label: "Context",
    title: "Pin the source",
    body: "The request starts beside the lecture note, PDF, or source excerpt the student is already reading.",
  },
  {
    label: "Answer",
    title: "Ask for a study edit",
    body: "Codex works in the same thread, with the source material still visible instead of drifting into a generic chat.",
  },
  {
    label: "Patch",
    title: "Read the exact diff",
    body: "The proposed note change is rendered as a patch panel with a short reason and evidence markers.",
  },
  {
    label: "Approve",
    title: "Apply from Obsidian",
    body: "The vault changes only after the user accepts the edit from the plugin surface.",
  },
] as const;

const installSteps = [
  {
    label: "BRAT",
    title: "Install BRAT in Obsidian",
    body: "Use the Beta Reviewers Auto-update Tool community plugin during the beta.",
  },
  {
    label: "Repo",
    title: "Add this GitHub repo",
    body: "Open BRAT settings, choose Add Beta Plugin, then paste the GitHub repo URL.",
  },
  {
    label: "Enable",
    title: "Enable VaultForgian",
    body: "Turn it on under Community plugins after Codex CLI is installed and logged in.",
  },
] as const;

const proofPoints = [
  "Evidence stays attached to the proposed rewrite.",
  "The diff is the write boundary, not a decorative afterthought.",
  "The recording plan uses a clean Obsidian vault and the real plugin surface.",
] as const;

const demoCuts = [
  {
    label: "Learning Mode",
    title: "Turn the note into practice.",
    body: "The created Pythagorean Theorem note becomes a short quiz flow from the plugin surface.",
    videoSrc: learningModeVideo,
  },
  {
    label: "Panel Studio",
    title: "Arrange the study workspace.",
    body: "Reserve this slot for the panel layout cut once the second screen recording is captured.",
    videoSrc: null,
  },
] as const;

const requirements = [
  "Obsidian desktop",
  "Codex CLI installed",
  "codex login completed",
  "Windows supported through WSL",
] as const;

const forgeSparks = Array.from({ length: 16 }, (_, index) => index);

type DemoRecordingStatus = "idle" | "checking" | "ready" | "missing";

function DemoRecordingPlaceholder({ status }: { status: DemoRecordingStatus }) {
  const isMissing = status === "missing";

  return (
    <div
      className="demo-recording-placeholder"
      role={status === "checking" ? "status" : undefined}
      aria-live={status === "checking" ? "polite" : undefined}
    >
      <p className="placeholder-kicker">
        {status === "checking" ? "Checking recording slot" : isMissing ? "Recording pending" : "Demo player deferred"}
      </p>
      <h3>{isMissing ? "Sanitized capture not attached yet." : "Workflow recording slot."}</h3>
      <p>
        {isMissing
          ? "The Obsidian screen recording will appear here once the public demo MP4 is added."
          : "The player stays unloaded until this section is viewed and a recording is available."}
      </p>
    </div>
  );
}

function DemoSlot() {
  const slotRef = useRef<HTMLDivElement>(null);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState<DemoRecordingStatus>("idle");

  useEffect(() => {
    const node = slotRef.current;
    if (!node || hasEnteredViewport) {
      return;
    }

    if (!("IntersectionObserver" in window)) {
      setHasEnteredViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasEnteredViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "360px 0px", threshold: 0.01 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasEnteredViewport]);

  useEffect(() => {
    if (!hasEnteredViewport) {
      return;
    }

    let cancelled = false;
    setRecordingStatus("checking");

    fetch(DEMO_RECORDING_PUBLIC_PATH, { method: "HEAD", cache: "no-store" })
      .then((response) => {
        const contentType = response.headers.get("content-type") ?? "";
        if (!cancelled) {
          setRecordingStatus(response.ok && contentType.startsWith("video/") ? "ready" : "missing");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecordingStatus("missing");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasEnteredViewport]);

  return (
    <div className="demo-player-shell" ref={slotRef}>
      {recordingStatus === "ready" ? (
        <Suspense
          fallback={
            <div className="demo-recording-placeholder" role="status">
              <p className="placeholder-kicker">Loading demo player</p>
              <h3>Preparing the Obsidian recording.</h3>
            </div>
          }
        >
          <DemoPlayer />
        </Suspense>
      ) : (
        <DemoRecordingPlaceholder status={recordingStatus} />
      )}
    </div>
  );
}

export default function App() {
  useEffect(() => {
    const revealTargets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const root = document.documentElement;
    const hero = document.querySelector<HTMLElement>(".hero-band");
    let scrollFrame = 0;

    const updateScrollProgress = () => {
      if (scrollFrame) {
        return;
      }
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        const maxScroll = Math.max(1, root.scrollHeight - window.innerHeight);
        const progress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
        const depth = Math.min(1, Math.max(0, window.scrollY / 720));
        root.style.setProperty("--scroll-progress", progress.toFixed(4));
        root.style.setProperty("--page-depth", depth.toFixed(4));
      });
    };

    const updateHeroPointer = (event: PointerEvent) => {
      if (!hero) {
        return;
      }
      const rect = hero.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return;
      }
      const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
      const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
      hero.style.setProperty("--pointer-x", `${x.toFixed(2)}%`);
      hero.style.setProperty("--pointer-y", `${y.toFixed(2)}%`);
    };

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
        threshold: 0.18,
        rootMargin: "0px 0px -8% 0px",
      },
    );
    revealTargets.forEach((target) => {
      const rect = target.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92) {
        target.classList.add("is-visible");
        return;
      }
      observer.observe(target);
    });
    updateScrollProgress();
    window.addEventListener("scroll", updateScrollProgress, { passive: true });
    window.addEventListener("resize", updateScrollProgress);
    hero?.addEventListener("pointermove", updateHeroPointer);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", updateScrollProgress);
      window.removeEventListener("resize", updateScrollProgress);
      hero?.removeEventListener("pointermove", updateHeroPointer);
      if (scrollFrame) {
        window.cancelAnimationFrame(scrollFrame);
      }
    };
  }, []);

  return (
    <div className="page-shell">
      <div className="scroll-progress" aria-hidden="true">
        <span />
      </div>
      <section className="hero-band">
        <img className="hero-backdrop-image" src={forgeVisual} alt="" />
        <div className="hero-energy-field" aria-hidden="true">
          {forgeSparks.map((spark) => (
            <span key={spark} />
          ))}
        </div>
        <div className="forge-beam" aria-hidden="true">
          <span />
          <span />
        </div>
        <header className="topbar">
          <a className="brand-lockup" href="#top" aria-label="VaultForgian home">
            <img className="brand-icon" src={navIcon} alt="" />
            <span>
              <small>Obsidian study workspace</small>
              <strong>VaultForgian</strong>
            </span>
          </a>
          <nav className="topbar-actions" aria-label="Primary navigation">
            <a href="#workflow">Workflow</a>
            <a href="#demo">Demo</a>
            <a href="#install">Install</a>
            <a href="#requirements">Requirements</a>
            <a href={repoUrl} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </nav>
        </header>

        <div className="hero-grid" id="top">
          <div className="hero-copy hero-enter">
            <p className="eyebrow">Codex inside Obsidian</p>
            <h1>VaultForgian</h1>
            <p className="hero-body">
              A study workbench for turning lecture context into reviewable note patches. Codex drafts the edit; the
              student keeps the write switch.
            </p>
            <div className="hero-actions">
              <a className="primary-cta" href="#demo">
                Watch live demo
              </a>
              <a className="secondary-cta" href="#install">
                Get VaultForgian
              </a>
            </div>
            <div className="hero-signals" aria-label="Product highlights">
              {heroSignals.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>

          <div className="hero-forge-panel hero-enter-delayed" aria-hidden="true">
            <div className="console-readout">
              <span>64-bit study console</span>
              <span>Vault patch buffer</span>
            </div>
            <div className="hero-caption">
              <span>Forge buffer</span>
              <strong>Source note -&gt; reviewed patch</strong>
              <small>Evidence remains visible before the vault changes.</small>
            </div>
          </div>
        </div>
      </section>

      <main className="page-main">
        <section className="bench-note reveal-up" data-reveal aria-label="Product design rule">
          <div className="bench-rule">
            <span>Rule 00</span>
            <strong>No silent vault writes.</strong>
          </div>
          <p>
            VaultForgian is shaped around one small boundary: help can be automated, but changing a study note should stay
            visible, inspectable, and reversible until the user approves it.
          </p>
          <div className="bench-readouts" aria-label="Implementation notes">
            <span>Obsidian desktop</span>
            <span>Codex CLI</span>
            <span>Patch queue</span>
          </div>
        </section>

        <section className="section workflow-section reveal-up" data-reveal id="workflow">
          <div className="section-heading">
            <p className="eyebrow">Approval-first workflow</p>
            <h2>The handoff is the product.</h2>
            <p>
              The important moment is not the answer. It is the handoff from model output to a note edit the student can
              actually review.
            </p>
          </div>

          <div className="workflow-track">
            {workflowSteps.map((step, index) => (
              <article className="workflow-step" key={step.label}>
                <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
                <p>{step.label}</p>
                <h3>{step.title}</h3>
                <span>{step.body}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="section demo-section reveal-up" data-reveal id="demo">
          <div className="demo-copy">
            <p className="eyebrow">Obsidian demo recording</p>
            <h2>Watch VaultForgian create a real note.</h2>
            <p>
              A short request asks for a new Pythagorean Theorem study note. Codex drafts it, VaultForgian turns it into a
              proposed vault change, and the note is written only after approval.
            </p>
            <div className="demo-chapters" aria-label="Demo recording chapters">
              {DEMO_CHAPTERS.map((chapter, index) => (
                <div className="demo-chapter" key={chapter.label}>
                  <span>{index + 1}</span>
                  <strong>{chapter.label}</strong>
                </div>
              ))}
            </div>
          </div>

          <DemoSlot />

          <div className="demo-cuts" aria-label="Additional workflow clips">
            {demoCuts.map((cut) => (
              <article className="demo-cut-card" key={cut.label}>
                <div className="demo-cut-copy">
                  <span>{cut.label}</span>
                  <h3>{cut.title}</h3>
                  <p>{cut.body}</p>
                </div>
                {cut.videoSrc ? (
                  <video
                    className="demo-cut-video"
                    controls
                    muted
                    playsInline
                    preload="metadata"
                    src={cut.videoSrc}
                    title={`${cut.label} demo clip`}
                  />
                ) : (
                  <div className="demo-cut-placeholder">
                    <span>Clip slot</span>
                    <strong>Recording pending</strong>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="section install-section reveal-up" data-reveal id="install">
          <div className="install-copy">
            <p className="eyebrow">Install from GitHub</p>
            <h2>Get VaultForgian into Obsidian.</h2>
            <p>
              During beta, the fastest path is BRAT: add this GitHub repo as a beta plugin, then enable
              VaultForgian inside Obsidian.
            </p>
            <div className="install-actions" aria-label="Install actions">
              <a className="primary-cta" href={repoUrl} target="_blank" rel="noreferrer">
                Install with BRAT
              </a>
              <a className="secondary-cta" href={releaseUrl} target="_blank" rel="noreferrer">
                Download latest ZIP
              </a>
              <a className="utility-cta" href={repoUrl} target="_blank" rel="noreferrer">
                View GitHub
              </a>
            </div>
            <div className="repo-capsule" aria-label="GitHub repository URL">
              <span>Repository URL for BRAT</span>
              <strong>KK1182112KK/vaultforgian</strong>
              <code>{repoUrl}</code>
            </div>
          </div>

          <figure className="forge-visual">
            <img src={forgeVisual} alt="Abstract low-poly visual of lecture notes being forged into a reviewable patch." />
            <figcaption>
              <span>Forge buffer</span>
              <strong>Source note -&gt; reviewed patch</strong>
            </figcaption>
          </figure>

          <div className="install-path" aria-label="Recommended BRAT install path">
            {installSteps.map((step, index) => (
              <article className="install-step" key={step.label}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{step.label}</p>
                <h3>{step.title}</h3>
                <small>{step.body}</small>
              </article>
            ))}
          </div>

          <div className="source-strip" aria-label="Source install command">
            <span>Build from source</span>
            <code>git clone {repoUrl} &amp;&amp; cd vaultforgian &amp;&amp; npm install &amp;&amp; npm run build</code>
          </div>
        </section>

        <section className="section proof-section reveal-up" data-reveal>
          <div className="section-heading">
            <p className="eyebrow">Patch evidence</p>
            <h2>The trust surface is the diff.</h2>
            <p>
              Trust is earned at the point of writing. The user sees what will change, why it changes, and where the
              claim came from.
            </p>
          </div>

          <div className="proof-layout">
            <div className="proof-list">
              {proofPoints.map((point) => (
                <p key={point}>{point}</p>
              ))}
            </div>

            <article className="patch-surface">
              <div className="patch-topline">
                <span>Lecture 15 note rewrite</span>
                <strong>Evidence-backed</strong>
              </div>
              <p className="patch-summary">
                Normalize LaTeX notation and add a short exam-facing interpretation.<span>[1]</span>
                <span>[2]</span>
              </p>
              <pre>
                <code>{`@@ Core Equations @@
+ $$\\oint_C \\mathbf{E}\\cdot d\\mathbf{l}
+   = -\\frac{d}{dt}\\int_S \\mathbf{B}\\cdot d\\mathbf{s}$$
+ Added a concise recall note under the equation.`}</code>
              </pre>
              <div className="patch-actions">
                <button type="button">Reject</button>
                <button type="button">Apply patch</button>
              </div>
            </article>
          </div>
        </section>

        <section className="section requirements-section reveal-up" data-reveal id="requirements">
          <div className="section-heading">
            <p className="eyebrow">Requirements</p>
            <h2>Install once, then work inside Obsidian.</h2>
          </div>
          <div className="requirements-row">
            {requirements.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <p className="requirements-note">
            The plugin uses the official Codex CLI session. Install the CLI, run <code>codex login</code>, then open
            the workspace inside Obsidian.
          </p>
        </section>

        <section className="final-cta reveal-up" data-reveal>
          <img src={navIcon} alt="" />
          <div>
            <p className="eyebrow">VaultForgian</p>
            <h2>Bring the patch gate into your vault.</h2>
          </div>
          <div className="hero-actions">
            <a className="primary-cta" href="#install">
              Get VaultForgian
            </a>
            <a className="secondary-cta" href={repoUrl} target="_blank" rel="noreferrer">
              View GitHub
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
