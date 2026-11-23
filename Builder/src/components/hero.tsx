"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { ArrowDown, ArrowUpRight, Box, Check, FileArchive } from "lucide-react";

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const blueprintY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : 170]);
  const blueprintScale = useTransform(scrollYProgress, [0, 1], [1, reduceMotion ? 1 : 0.76]);
  const blueprintRotate = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : -7]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : 90]);
  const fade = useTransform(scrollYProgress, [0, 0.85], [1, 0.2]);

  return (
    <section ref={ref} className="hero" aria-labelledby="hero-title">
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-glow" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Forge home">
          <span className="brand-mark"><Box size={18} strokeWidth={1.8} /></span>
          <span>FORGE</span>
          <span className="brand-edition">/ BUILDER</span>
        </a>
        <nav className="nav-links" aria-label="Main navigation">
          <a href="#console">Build bay</a>
          <a href="#security">Security</a>
          <a href="#limits">Limits</a>
        </nav>
        <a className="nav-sample" href="/api/sample" download>
          Test project <ArrowUpRight size={15} />
        </a>
      </header>

      <motion.div className="hero-inner" style={{ opacity: fade }}>
        <motion.div className="hero-copy" style={{ y: copyY }}>
          <motion.div
            className="eyebrow hero-eyebrow"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.15 }}
          >
            <span className="live-dot" /> Archive-to-build infrastructure
          </motion.div>
          <h1 id="hero-title">
            {["Your archive.", "Your Supabase.", "Actually built."].map((line, index) => (
              <span className="headline-mask" key={line}>
                <motion.span
                  className={index === 2 ? "headline-accent" : ""}
                  initial={{ y: "110%", rotate: 2 }}
                  animate={{ y: 0, rotate: 0 }}
                  transition={{ duration: 0.95, delay: 0.22 + index * 0.12, ease: [0.16, 1, 0.3, 1] }}
                >
                  {line}
                </motion.span>
              </span>
            ))}
          </h1>
          <motion.p
            className="hero-description"
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.7 }}
          >
            Upload a Next.js ZIP. Connect Supabase. Inspect every detail before authorizing a genuine production build—with live logs and an export you can take anywhere.
          </motion.p>
          <motion.div
            className="hero-actions"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.85 }}
          >
            <a className="button button-acid" href="#console">Open the build bay <ArrowDown size={17} /></a>
            <a className="text-link" href="/api/sample" download>Download a real test ZIP <ArrowUpRight size={15} /></a>
          </motion.div>
        </motion.div>

        <motion.div
          className="blueprint-wrap"
          style={{ y: blueprintY, scale: blueprintScale, rotate: blueprintRotate }}
          initial={{ opacity: 0, scale: 0.88 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.1, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          aria-label="Archive inspection and build pipeline illustration"
        >
          <div className="blueprint-orbit orbit-one" aria-hidden="true" />
          <div className="blueprint-orbit orbit-two" aria-hidden="true" />
          <div className="blueprint-card">
            <div className="blueprint-topline">
              <span>BUILD PIPELINE</span><span>NO. 001</span>
            </div>
            <div className="blueprint-core">
              <div className="core-ring"><FileArchive size={34} strokeWidth={1.2} /></div>
              <span className="core-label">SOURCE.ZIP</span>
              <span className="core-path">/workspace/next-app</span>
            </div>
            <div className="pipeline-list">
              {["Validate archive", "Inspect manifest", "Inject environment", "Compile + package"].map((step, index) => (
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.9 + index * 0.12 }}
                >
                  <span className="pipeline-index">0{index + 1}</span>
                  <span>{step}</span>
                  <Check size={14} />
                </motion.div>
              ))}
            </div>
            <div className="blueprint-specs">
              <div><strong>50 MB</strong><span>ZIP INPUT</span></div>
              <div><strong>AES-256</strong><span>KEY STORAGE</span></div>
              <div><strong>0</strong><span>HOST SECRETS</span></div>
            </div>
          </div>
          <div className="floating-tag tag-safe"><span /> EXECUTION GATED</div>
          <div className="floating-tag tag-output">.NEXT / VERIFIED <ArrowUpRight size={13} /></div>
        </motion.div>
      </motion.div>

      <div className="hero-foot">
        <span>ZIP VALIDATION</span><span>SUPABASE ENV INJECTION</span><span>REAL BUILD LOGS</span><span>ARTIFACT EXPORT</span>
      </div>
    </section>
  );
}
