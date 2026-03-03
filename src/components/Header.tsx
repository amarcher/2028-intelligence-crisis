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
    <header className="mb-14 text-center">
      <div
        className="text-[10px] tracking-[0.25em] font-bold font-mono mb-3"
        style={{ color: COLORS.accent }}
      >
        INDEPENDENT FORECAST TRACKER
      </div>
      <h1 className="text-[clamp(28px,5vw,44px)] font-black leading-[1.1] tracking-[-0.03em] m-0 font-display relative">
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
        className="text-sm max-w-[500px] mx-auto mt-5 leading-[1.7] text-center"
        style={{ color: COLORS.textDim }}
      >
        Fact-checking{' '}
        <a
          href="https://www.citriniresearch.com/p/2028gic"
          style={{ color: COLORS.text, textDecoration: 'underline', textUnderlineOffset: '2px' }}
        >
          a February 2026 macro scenario
        </a>{' '}
        against live data. Each section tracks one link in the predicted causal chain.
      </p>

      {/* Chain nav buttons */}
      <div className="flex justify-center items-center gap-2 mt-7 flex-wrap">
        {SECTIONS.map((s, i) => (
          <span key={s.id} className="contents">
            {i > 0 && (
              <span
                className="text-sm font-mono"
                style={{ color: COLORS.textDim }}
              >
                →
              </span>
            )}
            <button
              onClick={() => {
                document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="text-[10px] font-bold tracking-[0.06em] font-mono cursor-pointer py-1.5 px-3.5 rounded transition-all duration-200"
              style={{
                background: `${s.color}20`,
                border: `1px solid ${s.color}40`,
                color: s.color,
              }}
            >
              {s.label}
            </button>
          </span>
        ))}
        <span
          className="text-sm font-mono"
          style={{ color: COLORS.textDim }}
        >
          ↻
        </span>
      </div>
    </header>
  );
}
