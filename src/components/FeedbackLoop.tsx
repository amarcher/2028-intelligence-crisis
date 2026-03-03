import { COLORS } from '../lib/constants';

type LoopNode = { text: string; color: string; active: boolean; sectionId: string };

const LOOP_NODES: LoopNode[] = [
  { text: 'AI improves', color: COLORS.purple, active: true, sectionId: 'ai' },
  { text: 'Companies cut jobs', color: COLORS.accent, active: false, sectionId: 'labor' },
  { text: 'Workers spend less', color: COLORS.warning, active: false, sectionId: 'consumer' },
  { text: 'Revenue pressure', color: COLORS.blue, active: false, sectionId: 'saas' },
  { text: 'More AI investment', color: COLORS.teal, active: false, sectionId: 'ai' },
];

const RX = 230;
const RY = 155;
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

/** Find where a ray from (cx,cy) in direction (dx,dy) exits a NODE_W×NODE_H rect */
function rectEdge(cx: number, cy: number, dx: number, dy: number) {
  const hw = NODE_W / 2;
  const hh = NODE_H / 2;
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

function curvedArrow(i: number, next: number, total: number) {
  const from = nodePos(i, total);
  const to = nodePos(next, total);

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / dist;
  const uy = dy / dist;

  // For the top node (index 0), force arrows to connect at left/right sides
  let start: { x: number; y: number };
  let end: { x: number; y: number };

  if (i === 0) {
    // Exiting top node: from right side
    start = { x: from.x + NODE_W / 2, y: from.y };
  } else {
    start = rectEdge(from.x, from.y, ux, uy);
  }

  if (next === 0) {
    // Entering top node: to left side
    end = { x: to.x - NODE_W / 2, y: to.y };
  } else {
    end = rectEdge(to.x, to.y, -ux, -uy);
  }

  // Curve outward from center (right-hand normal for clockwise flow)
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const bulge = 30;
  const cx = mx + uy * bulge;
  const cy = my + (-ux) * bulge;

  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y, cx, cy };
}

function scrollToSection(sectionId: string) {
  document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

          {/* Clickable nodes */}
          {LOOP_NODES.map((node, i) => {
            const { x, y } = nodePos(i, n);
            return (
              <g
                key={i}
                style={{ cursor: 'pointer' }}
                onClick={() => scrollToSection(node.sectionId)}
              >
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
