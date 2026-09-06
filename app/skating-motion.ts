import { MathUtils, Quaternion, Vector3 } from 'three';

const TAU = Math.PI * 2;
const DOWN = new Vector3(0, -1, 0);
export const LEG_LENGTHS = [0.46, 0.445] as const;
export const ARM_LENGTHS = [0.32, 0.305] as const;
export const ICE_HEIGHT = 0.026;

export function ease(value: number) {
  const t = MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Two-bone IK preserves anatomical segment lengths; the pole controls the bend.
export function solveJoint(start: Vector3, end: Vector3, a: number, b: number, pole: Vector3) {
  const axis = end.clone().sub(start);
  const distance = MathUtils.clamp(axis.length(), Math.abs(a - b) + 0.0001, a + b - 0.0001);
  axis.normalize();
  const bend = pole.clone().addScaledVector(axis, -pole.dot(axis));
  if (bend.lengthSq() < 0.0001) bend.set(1, 0, 0).addScaledVector(axis, -axis.x);
  bend.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  return start.clone().addScaledVector(axis, along)
    .addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
}

export type FootPose = {
  position: Vector3;
  rotation: Vector3;
  contact: boolean;
  pressure: number;
};

export function sampleFoot(cycle: number, side: -1 | 1, turn: number): FootPose {
  const phase = ((cycle + (side === 1 ? 0.5 : 0)) % 1 + 1) % 1;
  const stance = MathUtils.lerp(0.62, side === 1 ? 0.57 : 0.6, turn);
  const contact = phase < stance;
  const u = contact ? phase / stance : (phase - stance) / (1 - stance);
  const move = ease(u);
  const lift = contact ? 0 : Math.sin(Math.PI * u) ** 2;
  const startX = MathUtils.lerp(side * 0.095, side === 1 ? -0.2 : -0.24, turn);
  const endX = MathUtils.lerp(side * 0.59, side === 1 ? 0.43 : 0.3, turn);
  const startZ = MathUtils.lerp(0.12, side === 1 ? 0.19 : -0.015, turn);
  const endZ = MathUtils.lerp(-0.22, side === 1 ? -0.12 : -0.27, turn);
  const pressure = contact ? Math.sin(Math.PI * u) : 0;
  return {
    position: new Vector3(
      MathUtils.lerp(contact ? startX : endX, contact ? endX : startX, move),
      lift * (0.14 + (side === 1 ? 0.085 : 0.035) * turn),
      MathUtils.lerp(contact ? startZ : endZ, contact ? endZ : startZ, move) + lift * 0.06,
    ),
    // Rotation is around the blade's contact edge, never around the pelvis.
    rotation: new Vector3(lift * -0.22, side * pressure * 0.14 * (1 - turn) + lift * side * 0.14,
      turn * 0.43 + side * pressure * 0.17 * (1 - turn)),
    contact,
    pressure,
  };
}

export type LimbPose = { start: Vector3; joint: Vector3; end: Vector3 };
export type SkatingPose = {
  pelvis: Vector3;
  torso: Quaternion;
  head: Vector3;
  headRotation: Vector3;
  feet: [FootPose, FootPose];
  legs: [LimbPose, LimbPose];
  arms: [LimbPose, LimbPose];
};

export function sampleSkatingPose(cycle: number, turn: number, effort: number, idle = 0): SkatingPose {
  turn *= 1 - idle;
  const wave = Math.cos(cycle * TAU);
  const sway = -wave * 0.105 * (1 - turn * 0.62) * (1 - idle);
  const pelvis = new Vector3(sway - turn * 0.29, MathUtils.lerp(0.755 - turn * 0.115, 1.015, idle), -0.06);
  pelvis.y += Math.sin(cycle * TAU * 2) * 0.009 * (1 - idle);
  const forward = MathUtils.lerp(1.00 + effort * 0.1, 0.08, idle);
  const bank = turn * 0.58 - sway * 0.22;
  const pitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), forward);
  const lean = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), bank);
  const torso = lean.multiply(pitch);
  const torsoPoint = (x: number, y: number, z: number) => new Vector3(x, y, z).applyQuaternion(torso).add(pelvis);
  const head = torsoPoint(0, 0.595, 0.02).add(new Vector3(0, 0.105, 0.024));
  const feet = ([-1, 1] as const).map((side) => {
    const foot = sampleFoot(cycle, side, turn);
    foot.position.lerp(new Vector3(side * 0.17, 0, side * 0.045), idle);
    foot.rotation.multiplyScalar(1 - idle);
    if (idle > 0.99) foot.contact = true;
    return foot;
  }) as [FootPose, FootPose];

  const legs = ([-1, 1] as const).map((side, i) => {
    const start = pelvis.clone().add(new Vector3(side * 0.108, -0.015, 0));
    const foot = feet[i];
    const ankle = new Vector3(0, 0.162, -0.032).applyQuaternion(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), foot.rotation.z),
    ).add(foot.position);
    const joint = solveJoint(start, ankle, ...LEG_LENGTHS, new Vector3(side * 0.1, 0, 1));
    return { start, joint, end: ankle };
  }) as [LimbPose, LimbPose];

  const arms = ([-1, 1] as const).map((side) => {
    const start = torsoPoint(side * 0.190, 0.46, 0);
    const swing = Math.sin(cycle * TAU + (side === 1 ? Math.PI : 0));
    const hand = torsoPoint(side * 0.18, 0.035, -0.22);
    const drive = new Vector3(sway + side * 0.30, 0.64 + swing * 0.10, 0.12 + swing * 0.40);
    hand.lerp(drive, effort * (1 - turn) * 0.72);
    if (side === -1) hand.lerp(new Vector3(-0.64, 0.058, 0.39), turn);
    const idleHand = new Vector3(side * 0.25, 1.03, 0.2);
    hand.lerp(idleHand, idle);
    // The glove is constrained to the arm's reach before solving the elbow.
    const reach = hand.clone().sub(start).clampLength(0.12, ARM_LENGTHS[0] + ARM_LENGTHS[1] - 0.002);
    hand.copy(start).add(reach);
    const joint = solveJoint(start, hand, ...ARM_LENGTHS, new Vector3(side * 0.6, -0.3, -1));
    return { start, joint, end: hand };
  }) as [LimbPose, LimbPose];
  return { pelvis, torso, head, headRotation: new Vector3(-0.065, -turn * 0.13, bank * 0.24), feet, legs, arms };
}

export function limbRotations(pose: LimbPose) {
  const upper = new Quaternion().setFromUnitVectors(DOWN, pose.joint.clone().sub(pose.start).normalize());
  const lowerWorld = new Quaternion().setFromUnitVectors(DOWN, pose.end.clone().sub(pose.joint).normalize());
  return { upper, lower: upper.clone().invert().multiply(lowerWorld) };
}

export function advanceCycle(cycle: number, cadence: number, speed: number, dt: number, moving: boolean) {
  const target = moving ? MathUtils.clamp(0.65 + speed * 0.038, 0.65, 1.35) : 0.14;
  const nextCadence = MathUtils.damp(cadence, target, 4.5, dt);
  return { cadence: nextCadence, cycle: (cycle + nextCadence * dt) % 1 };
}
