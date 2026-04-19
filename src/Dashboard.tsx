import Header from './components/Header';
import OverviewStats from './components/OverviewStats';
import AICapability from './components/sections/AICapability';
import SaaSDisruption from './components/sections/SaaSDisruption';
import LaborDisplacement from './components/sections/LaborDisplacement';
import ConsumerImpact from './components/sections/ConsumerImpact';
import FinancialContagion from './components/sections/FinancialContagion';
import PhaseFlipSignals from './components/sections/PhaseFlipSignals';
import AgentDigest from './components/sections/AgentDigest';
import ShippingPulse from './components/sections/ShippingPulse';
import FeedbackLoop from './components/FeedbackLoop';
import ClaimTracker from './components/ClaimTracker';
import Methodology from './components/Methodology';

export default function Dashboard() {
  return (
    <>
      <Header />
      <OverviewStats />
      <AICapability />
      <SaaSDisruption />
      <LaborDisplacement />
      <ConsumerImpact />
      <FinancialContagion />
      <PhaseFlipSignals />
      <AgentDigest />
      <ShippingPulse />
      <FeedbackLoop />
      <ClaimTracker />
      <Methodology />
    </>
  );
}
