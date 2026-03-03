import { COLORS } from '../lib/constants';

type LoopNode = { text: string; color: string; active: boolean };

const LOOP_NODES: LoopNode[] = [
  { text: 'AI improves', color: COLORS.purple, active: true },
  { text: 'Companies cut jobs', color: COLORS.accent, active: false },
  { text: 'Workers spend less', color: COLORS.warning, active: false },
  { text: 'Revenue pressure', color: COLORS.blue, active: false },
  { text: 'More AI investment', color: COLORS.teal, active: false },
];

const RX = 230; // horizontal radius
const RY = 155; // vertical radius
const NODE_W = 140;
const NODE_H = 36;
const W = RX * 2 + NODE_W + 20;
const H = RY * 2 + NODE_H + 40;
const CX = W / 2;
const CY = H / 2;

function nodePos(i: number, total: number) {
  const angle = ((2 * Math.PI) / total) * i - Math.PI / 2;
  return {
    x: CX + RX * Math.cos(angle),
    y: CY + RY * Math.sin(angle),
  };
}

function curvedArrow(i: number, next: number, total: number) {
  const from = nodePos(i, total);
  const to = nodePos(next, total);

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / dist;
  const uy = dy / dist;
  const gap = 46;

  const x1 = from.x + ux * gap;
  const y1 = from.y + uy * gap;
  const x2 = to.x - ux * gap;
  const y2 = to.y - uy * gap;

  // Curve outward from center
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const nx = -(y2 - y1);
  const ny = x2 - x1;
  const nLen = Math.sqrt(nx * nx + ny * ny);
  const bulge = 20;
  const cx = mx + (nx / nLen) * bulge;
  const cy = my + (ny / nLen) * bulge;

  return { x1, y1, x2, y2, cx, cy };
}

export default function FeedbackLoop() {
  const n = LOOP_NODES.length;

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
        className="text-lg font-extrabold mb-2 font-display"
        style={{ color: COLORS.textBright }}
      >
        Intelligence Displacement Spiral
      </h3>

      <div className="flex justify-center">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="max-w-full"
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill={COLORS.textDim} />
            </marker>
          </defs>

          {/* Curved arrow paths */}
          {LOOP_NODES.map((_, i) => {
            const next = (i + 1) % n;
            const a = curvedArrow(i, next, n);
            return (
              <path
                key={`arrow-${i}`}
                d={`M ${a.x1} ${a.y1} Q ${a.cx} ${a.cy} ${a.x2} ${a.y2}`}
                fill="none"
                stroke={COLORS.textDim}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                markerEnd="url(#arrowhead)"
              />
            );
          })}

          {/* Nodes */}
          {LOOP_NODES.map((node, i) => {
            const { x, y } = nodePos(i, n);
            return (
              <g key={i}>
                <rect
                  x={x - NODE_W / 2}
                  y={y - NODE_H / 2}
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  fill={node.active ? `${node.color}25` : `${node.color}10`}
                  stroke={node.active ? node.color : `${node.color}30`}
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={node.active ? node.color : `${node.color}80`}
                  fontSize={11}
                  fontFamily="'JetBrains Mono', 'Fira Code', monospace"
                  fontWeight={node.active ? 700 : 400}
                >
                  {node.text}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 text-xs leading-[1.6]" style={{ color: COLORS.textDim }}>
        <span style={{ color: COLORS.purple }}>■</span> Active &nbsp;
        <span style={{ color: COLORS.textDim }}>□</span> Not yet triggered
      </div>
    </div>
  );
}
