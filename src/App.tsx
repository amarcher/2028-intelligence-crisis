import { Analytics } from '@vercel/analytics/react';
import Dashboard from './Dashboard';

export default function App() {
  return (
    <div className="bg-[#0a0a0f] min-h-screen text-[#c8c8d4] font-sans relative overflow-hidden">
      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-40 pointer-events-none z-0"
        style={{
          backgroundImage: `
            linear-gradient(#1a1a28 1px, transparent 1px),
            linear-gradient(90deg, #1a1a28 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Accent glow */}
      <div className="fixed -top-[200px] -right-[200px] w-[600px] h-[600px] rounded-full pointer-events-none z-0 bg-[radial-gradient(circle,rgba(255,77,58,0.15),transparent_70%)]" />

      <div className="relative z-[1] max-w-[900px] mx-auto px-5 pt-10 pb-20">
        <Dashboard />
      </div>
      <Analytics />
    </div>
  );
}
