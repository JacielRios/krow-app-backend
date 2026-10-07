'use client';
import { Navbar } from './Navbar';
import { Hero } from './Hero';
import { ValueProps } from './ValueProps';
import { HowItWorks } from './HowItWorks';
import { AudienceSplit } from './AudienceSplit';
import { StatsBand } from './StatsBand';
import { TrustFaq } from './TrustFaq';
import { CtaBanner } from './CtaBanner';
import { Footer } from './Footer';
import './landing.css';

export default function LandingPage() {
  return (
    <div className="landing">
      <Navbar />
      <main>
        <Hero />
        <ValueProps />
        <HowItWorks />
        <AudienceSplit />
        <StatsBand />
        <TrustFaq />
        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}
