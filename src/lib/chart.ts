/** Pure helpers for the small SVG charts (no chart library). */

export type Point = readonly [x: number, y: number];

/** A round number at or above `max` for the top of the chart (1, 2, 2.5 or 5 × 10ⁿ). */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= max) ?? 10;
  return step * power;
}

/** Spreads values across `width`, value 0 at the bottom and `top` at the top (y grows downwards). */
export function toPoints(values: readonly number[], width: number, height: number, top: number): Point[] {
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((v, i) => [i * step, height - (Math.max(0, v) / top) * height] as const);
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Smooth line through the points (Catmull-Rom as cubic Béziers), never overshooting the chart floor. */
export function smoothPath(points: readonly Point[], floor: number): string {
  const [first] = points;
  if (!first) return "";
  let d = `M${r(first[0])},${r(first[1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1y = Math.min(floor, p1[1] + (p2[1] - p0[1]) / 6);
    const c2y = Math.min(floor, p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${r(p1[0] + (p2[0] - p0[0]) / 6)},${r(c1y)} ${r(p2[0] - (p3[0] - p1[0]) / 6)},${r(c2y)} ${r(p2[0])},${r(p2[1])}`;
  }
  return d;
}

/** The line closed down to the floor, for the filled area under it. */
export function areaPath(points: readonly Point[], floor: number): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "";
  return `${smoothPath(points, floor)} L${r(last[0])},${floor} L${r(first[0])},${floor} Z`;
}
