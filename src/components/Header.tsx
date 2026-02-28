import { useState, useEffect } from 'react';
import { COLORS, SECTIONS } from '../lib/constants';

export default function Header() {
  const [glitch, setGlitch] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setGlitch(true);
      setTimeout(() => setGlitch(false), 150);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="mb-12 text-center">
      <div
        className="text-[10px] tracking-[0.25em] font-bold font-mono mb-3"
        style={{ color: COLORS.accent }}
      >
        CITRINI RESEARCH — FORECAST TRACKER
      </div>
      <h1 className="text-[clamp(28px,5vw,44px)] font-black leading-[1.1] tracking-tight m-0 font-display relative">
        <span
          className="inline-block transition-all duration-50"
          style={{
            color: COLORS.textBright,
            opacity: glitch ? 0.6 : 1,
            transform: glitch ? 'translateX(-2px)' : 'none',
          }}
        >
          THE 2028 GLOBAL
        </span>
        <br />
        <span style={{ color: COLORS.accent }}>INTELLIGENCE CRISIS</span>
      </h1>
      <p
        className="text-sm max-w-[560px] mx-auto mt-4 leading-[1.7]"
        style={{ color: COLORS.textDim }}
      >
        Tracking the veracity of Citrini Research&apos;s February 2026 macro scenario in real time.
        Each section maps to a link in their predicted causal chain.
      </p>

      {/* Chain nav buttons */}
      <div className="flex justify-center gap-0.5 mt-7 flex-wrap">
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => {
              document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="text-[10px] font-bold tracking-[0.06em] font-mono cursor-pointer py-1.5 px-3.5 relative transition-all duration-200"
            style={{
              background: `${s.color}20`,
              border: `1px solid ${s.color}40`,
              color: s.color,
              borderRadius:
                i === 0 ? '4px 0 0 4px' : i === SECTIONS.length - 1 ? '0 4px 4px 0' : '0',
            }}
          >
            {i > 0 && (
              <span
                className="absolute -left-1.5 top-1/2 -translate-y-1/2 text-[8px]"
                style={{ color: COLORS.textDim }}
              >
                →
              </span>
            )}
            {s.label}
          </button>
        ))}
      </div>
    </header>
  );
}
