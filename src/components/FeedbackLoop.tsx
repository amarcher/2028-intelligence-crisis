import { COLORS } from '../lib/constants';

type LoopNode = { text: string; color: string; active: boolean };

const LOOP_NODES: LoopNode[] = [
  { text: 'AI improves', color: COLORS.purple, active: true },
  { text: 'Companies cut jobs', color: COLORS.accent, active: false },
  { text: 'Workers spend less', color: COLORS.warning, active: false },
  { text: 'Revenue pressure', color: COLORS.blue, active: false },
  { text: 'More AI investment', color: COLORS.teal, active: false },
  { text: 'AI improves ↻', color: COLORS.purple, active: true },
];

export default function FeedbackLoop() {
  return (
    <div
      className="rounded-lg p-7 mb-10 text-center"
      style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }}
    >
      <div
        className="text-[10px] font-bold tracking-[0.15em] font-mono mb-3"
        style={{ color: COLORS.accent }}
      >
        THE NEGATIVE FEEDBACK LOOP
      </div>
      <h3
        className="text-lg font-extrabold mb-5 font-display"
        style={{ color: COLORS.textBright }}
      >
        Intelligence Displacement Spiral
      </h3>
      <div className="flex flex-wrap justify-center items-center gap-0 text-xs font-mono">
        {LOOP_NODES.map((node, i) => (
          <span key={i} className="contents">
            {i > 0 && (
              <span className="text-base mx-1" style={{ color: COLORS.textDim }}>→</span>
            )}
            <span
              className="py-1.5 px-3 rounded text-[11px]"
              style={{
                background: node.active ? `${node.color}25` : `${node.color}10`,
                border: `1px solid ${node.active ? node.color : `${node.color}30`}`,
                color: node.active ? node.color : `${node.color}80`,
                fontWeight: node.active ? 700 : 400,
              }}
            >
              {node.text}
            </span>
          </span>
        ))}
      </div>
      <div className="mt-4 text-xs leading-[1.6]" style={{ color: COLORS.textDim }}>
        <span style={{ color: COLORS.purple }}>■</span> Active &nbsp;
        <span style={{ color: COLORS.textDim }}>□</span> Not yet triggered
      </div>
    </div>
  );
}
