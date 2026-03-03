/** Custom Recharts label for segment reference lines.
 *  Renders text to the LEFT of the segment start so it never clips the right edge.
 *  Flips below the line when near the top of the chart. */
export default function ArticleLabel({ viewBox, value, fill }: {
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
  value?: string;
  fill?: string;
}) {
  const x = (viewBox?.x ?? 0) - 6;
  const rawY = viewBox?.y ?? 0;
  // If the line is near the top of the chart (<20px), place label below instead of above
  const y = rawY < 20 ? rawY + 12 : rawY - 6;
  return (
    <text x={x} y={y} textAnchor="end" fill={fill} fontSize={9}>
      {value}
    </text>
  );
}
