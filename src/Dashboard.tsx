import Header from './components/Header';
import OverviewStats from './components/OverviewStats';
import AICapability from './components/sections/AICapability';
import SaaSDisruption from './components/sections/SaaSDisruption';
import LaborDisplacement from './components/sections/LaborDisplacement';
import ConsumerImpact from './components/sections/ConsumerImpact';
import FinancialContagion from './components/sections/FinancialContagion';
import PhaseFlipSignals from './components/sections/PhaseFlipSignals';
import MetaSignals from './components/sections/MetaSignals';
import AgentDigest from './components/sections/AgentDigest';
import ShippingPulse from './components/sections/ShippingPulse';
import FeedbackLoop from './components/FeedbackLoop';
import ClaimTracker from './components/ClaimTracker';
import Methodology from './components/Methodology';

export default function Dashboard() {
  return (
    <>
      <Header />
      {import.meta.env.VITE_USE_REAL_DATA !== 'true' && <p role="status" className="p-4 font-bold">DEMO MODE — sample data, not current evidence.</p>}
      <AgentDigest />
      <PhaseFlipSignals />
      <MetaSignals />
      <ShippingPulse />
      <details className="my-6 p-4 border rounded">
        <summary className="cursor-pointer font-bold">Original thesis and historical context — editorial assessments are not live signals</summary>
        <p className="my-3">The sections below contain seeded claims, sample indicators and historical verdicts. Expired forecast deadlines need a fresh review; these labels do not establish that predictions came true.</p>
        <OverviewStats />
        <AICapability />
        <SaaSDisruption />
        <LaborDisplacement />
        <ConsumerImpact />
        <FinancialContagion />
        <FeedbackLoop />
        <ClaimTracker />
      </details>
      <Methodology />
    </>
  );
}
