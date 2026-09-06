import { MathUtils, Vector3 } from 'three';
const ease = (value: number) => MathUtils.smootherstep(value, 0, 1);

export const LAP_LENGTH = 111.12;
export const BEND_RADIUS = 8.35;
export const STRAIGHT_LENGTH = (LAP_LENGTH - Math.PI * 2 * BEND_RADIUS) / 2;

// Constant distance along two straights and two semicircles, with an inside/outside lane offset.
export function trackSample(distance: number, lane = 1) {
  const d = ((distance % LAP_LENGTH) + LAP_LENGTH) % LAP_LENGTH;
  const half = STRAIGHT_LENGTH / 2;
  const arc = Math.PI * BEND_RADIUS;
  const r = BEND_RADIUS + (lane - 1) * 0.95;
  let x: number, z: number, tx: number, tz: number, corner = 0;
  if (d < half) {
    x = d; z = -r; tx = 1; tz = 0;
    corner = 0.28 * ease((d - half + 1.8) / 1.8);
  } else if (d < half + arc) {
    const u = d - half, a = -Math.PI / 2 + u / BEND_RADIUS;
    x = half + Math.cos(a) * r; z = Math.sin(a) * r;
    tx = -Math.sin(a); tz = Math.cos(a);
    corner = MathUtils.lerp(0.28, 1, ease(Math.min(u, arc - u) / 2.8));
  } else if (d < half + arc + STRAIGHT_LENGTH) {
    const u = d - half - arc;
    x = half - u; z = r; tx = -1; tz = 0;
    corner = 0.28 * (1 - ease(Math.min(u, STRAIGHT_LENGTH - u) / 1.8));
  } else if (d < half + arc * 2 + STRAIGHT_LENGTH) {
    const u = d - half - arc - STRAIGHT_LENGTH, a = Math.PI / 2 + u / BEND_RADIUS;
    x = -half + Math.cos(a) * r; z = Math.sin(a) * r;
    tx = -Math.sin(a); tz = Math.cos(a);
    corner = MathUtils.lerp(0.28, 1, ease(Math.min(u, arc - u) / 2.8));
  } else {
    const u = d - half - arc * 2 - STRAIGHT_LENGTH;
    x = -half + u; z = -r; tx = 1; tz = 0;
    corner = 0.28 * (1 - ease(u / 1.8));
  }
  return { position: new Vector3(x, 0, z), tangent: new Vector3(tx, 0, tz), outward: new Vector3(tz, 0, -tx), corner };
}

export function trackPoints(lane: number, height: number, count = 256) {
  return Array.from({ length: count + 1 }, (_, i) => trackSample(i / count * LAP_LENGTH, lane).position.setY(height));
}
