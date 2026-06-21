import NavBar from "@/components/layout/NavBar";
import HeroSection from "@/components/sections/HeroSection";
import FeatureSection from "@/components/sections/FeatureSection";
import AgentsSection from "@/components/sections/AgentsSection";
import ObservatorySection from "@/components/sections/ObservatorySection";
import CtaSection from "@/components/sections/CtaSection";

export default function Home() {
  return (
    <>
      <NavBar />
      <HeroSection />
      <FeatureSection />
      <AgentsSection />
      <ObservatorySection />
      <CtaSection />
    </>
  );
}
