"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUpRight, Braces, FileCheck2, KeyRound, PackageCheck, ShieldCheck, TerminalSquare } from "lucide-react";

const faqs = [
  {
    question: "Does Forge run code as soon as I upload it?",
    answer: "No. Upload only stores and reads the ZIP. Forge validates paths and inspects metadata without extracting executable content. Dependency lifecycle scripts and your build script run only after you check the authorization box and start a build.",
  },
  {
    question: "Where do my Supabase keys go?",
    answer: "Keys are encrypted with AES-256-GCM using a local, mode-restricted builder key. They are decrypted only inside the worker and injected into the scrubbed child-process environment. They are excluded from archives and redacted from captured output when echoed.",
  },
  {
    question: "Can Forge deploy my app to a public URL?",
    answer: "Not in this runtime. Forge performs genuine installation and production compilation, then exports source plus .next output. It does not claim to deploy or host arbitrary uploaded applications. You can move the artifact to Vercel, a container host, or your own Next.js server.",
  },
  {
    question: "Why did pnpm, Yarn, or Bun fail to start?",
    answer: "Forge detects the package manager from packageManager and lockfiles, but the corresponding executable must exist on the build host. npm is the most portable option in this environment. The log reports the actual spawn error instead of converting it into a simulated result.",
  },
  {
    question: "What happens if my project needs more environment variables?",
    answer: "Add them in Advanced environment as KEY=value lines. Forge also reads .env.example to show expected keys. Host-only variables such as DATABASE_URL, PATH, HOME, and NODE_OPTIONS are blocked so an archive cannot inherit or alter the builder host.",
  },
];

export function InfoSections() {
  const [openFaq, setOpenFaq] = useState(0);
  return (
    <>
      <section className="security-section" id="security">
        <div className="section-heading inverse-heading">
          <span className="section-number">02 / UNDER THE HOOD</span>
          <h2>Permission is a<br /><em>technical boundary.</em></h2>
          <p>Every stage has a concrete job, an explicit input, and an inspectable output. No mystery progress bars. No synthetic success states.</p>
        </div>
        <div className="architecture-grid">
          {[
            { icon: FileCheck2, number: "01", title: "Read before you run", text: "Entry containment, traversal detection, symlink rejection, encrypted-entry rejection, file-count limits, extraction quotas, and compression-ratio checks happen before authorization.", meta: "yauzl / strict lazy-entry inspection" },
            { icon: KeyRound, number: "02", title: "Secrets stay server-side", text: "Supabase keys and custom environment values are encrypted at rest. The browser receives only saved/not-saved indicators, never ciphertext, plaintext, or internal paths.", meta: "AES-256-GCM / mode 0600 key" },
            { icon: TerminalSquare, number: "03", title: "One job, one workspace", text: "A detached worker recreates the workspace, extracts with the same archive policy, installs dependencies, and runs the declared build script without a shell.", meta: "Process groups / 5–20 minute timeouts" },
            { icon: PackageCheck, number: "04", title: "Proof you can download", text: "Forge checks that .next exists, retains exact exit codes and logs, and packages source with build output. Dependencies, caches, dotenv secrets, and symlinks are excluded.", meta: "ZIP artifact / BUILD-INFO.json" },
          ].map((item, index) => (
            <motion.article
              className="architecture-card"
              key={item.title}
              initial={{ opacity: 0, y: 45 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.65, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="architecture-card-top"><item.icon size={24} strokeWidth={1.4} /><span>{item.number}</span></div>
              <h3>{item.title}</h3><p>{item.text}</p><code>{item.meta}</code>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="limits-section" id="limits">
        <div className="section-heading">
          <span className="section-number">03 / COMPATIBILITY</span>
          <h2>Clear inputs.<br /><em>Honest limits.</em></h2>
        </div>
        <div className="limits-layout">
          <div className="compat-table" role="table" aria-label="Builder compatibility">
            {[
              ["Framework", "Next.js with a declared build script", "Required"],
              ["Routing", "App Router and Pages Router detection", "Detected"],
              ["Package managers", "npm, pnpm, Yarn, Bun", "Host binary required"],
              ["Upload ceiling", "50 MB compressed / 300 MB extracted", "Enforced"],
              ["Archive complexity", "12,000 entries / 80 MB per file", "Enforced"],
              ["Build output", "Verified .next directory + downloadable ZIP", "Generated"],
              ["Public preview hosting", "Not available in this runtime", "Not simulated"],
            ].map(([label, value, status]) => (
              <div className="compat-row" role="row" key={label}>
                <span role="cell">{label}</span><strong role="cell">{value}</strong><small role="cell">{status}</small>
              </div>
            ))}
          </div>
          <aside className="trust-note">
            <ShieldCheck size={28} strokeWidth={1.3} />
            <h3>Build code you trust.</h3>
            <p>The worker provides workspace and environment isolation, not a hardened multi-tenant security sandbox. A Next.js build can execute arbitrary repository code by design.</p>
            <p>Use Forge on a controlled host for your own projects. For untrusted public uploads, place the worker inside disposable containers or microVMs with network and privilege policies.</p>
            <a href="/api/sample" download>Inspect the test project <ArrowUpRight size={15} /></a>
          </aside>
        </div>
      </section>

      <section className="faq-section">
        <div className="faq-intro"><span className="section-number">04 / FIELD NOTES</span><h2>Before you<br />press build.</h2><Braces size={44} strokeWidth={1} /></div>
        <div className="faq-list">
          {faqs.map((faq, index) => (
            <div className={`faq-item ${openFaq === index ? "is-open" : ""}`} key={faq.question}>
              <button onClick={() => setOpenFaq(openFaq === index ? -1 : index)} aria-expanded={openFaq === index}>
                <span>0{index + 1}</span><strong>{faq.question}</strong><ArrowDown size={18} />
              </button>
              <AnimatePresence initial={false}>
                {openFaq === index && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28 }}>
                    <p>{faq.answer}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
