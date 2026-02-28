import MiniStat from './ui/MiniStat';

export default function OverviewStats() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 mb-9">
      <MiniStat label="UNEMPLOYMENT" value="4.1%" change="+0.3pp YoY" />
      <MiniStat label="JOLTS OPENINGS" value="7.6M" change="-14% YoY" />
      <MiniStat label="INITIAL CLAIMS" value="242K" change="+12% YoY" />
      <MiniStat label="S&P 500" value="5,954" change="-3.2% MTD" />
      <MiniStat label="10Y YIELD" value="4.28%" change="-22bp QoQ" />
    </div>
  );
}
