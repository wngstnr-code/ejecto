import { Compare } from "@/components/landing/compare";
import { CrashChart } from "@/components/landing/crash-chart";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { PilotLayer } from "@/components/landing/pilot-layer";
import { Preloader } from "@/components/landing/preloader";
import { Safeguards } from "@/components/landing/safeguards";
import { Statement } from "@/components/landing/statement";
import { SiteFooter } from "@/components/site/site-footer";
import { ScrollBar } from "@/components/site/scroll-bar";
import { SiteHeader } from "@/components/site/site-header";
import { SmoothScroll } from "@/components/site/smooth-scroll";

export default function Home() {
  return (
    <>
      <Preloader />
      <SmoothScroll />
      <ScrollBar />
      <SiteHeader />
      <PilotLayer />
      <main>
        <Hero />
        <Statement />
        <CrashChart />
        <HowItWorks />
        <Compare />
        <Safeguards />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
