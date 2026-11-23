import { BuilderConsole } from "@/components/builder-console";
import { Hero } from "@/components/hero";
import { InfoSections } from "@/components/info-sections";

export default function Home() {
  return (
    <main id="top">
      <Hero />
      <BuilderConsole />
      <InfoSections />
      <footer className="footer">
        <a className="brand footer-brand" href="#top">FORGE <span className="brand-edition">/ BUILDER</span></a>
        <p>Next.js archives in. Verifiable builds out.</p>
        <a href="#console">Return to build bay ↑</a>
      </footer>
    </main>
  );
}
