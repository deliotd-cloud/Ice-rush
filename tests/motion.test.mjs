import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceCycle, sampleFoot, sampleSkatingPose, LEG_LENGTHS, ARM_LENGTHS } from '../app/skating-motion.ts';
import { trackSample, LAP_LENGTH, STRAIGHT_LENGTH, BEND_RADIUS } from '../app/ice-track.ts';

test('limb lengths remain fixed through straight strides, crossovers and standing transitions', () => {
  for (let c = 0; c <= 10; c++) for (let frame = 0; frame < 240; frame++) for (const idle of [0, 0.5, 1]) {
    const pose = sampleSkatingPose(frame / 240, c / 10, 0.9, idle);
    for (const [limbs, lengths] of [[pose.legs, LEG_LENGTHS], [pose.arms, ARM_LENGTHS]]) {
      for (const limb of limbs) {
        assert.ok(Math.abs(limb.start.distanceTo(limb.joint) - lengths[0]) < 0.00001);
        assert.ok(Math.abs(limb.joint.distanceTo(limb.end) - lengths[1]) < 0.00001,
          `unreachable endpoint: turn=${c / 10} phase=${frame / 240} idle=${idle}`);
      }
    }
  }
});

test('at least one blade stays on ice and each foot returns smoothly across cycle boundaries', () => {
  for (const turn of [0, 0.2, 0.5, 0.8, 1]) {
    for (let frame = 0; frame < 600; frame++) {
      const left = sampleFoot(frame / 600, -1, turn), right = sampleFoot(frame / 600, 1, turn);
      assert.ok(left.contact || right.contact, 'both blades airborne');
      for (const foot of [left, right]) {
        assert.ok(foot.position.y >= 0);
        if (foot.contact) assert.equal(foot.position.y, 0);
      }
    }
    for (const side of [-1, 1]) {
      const before = sampleFoot(1 - 0.00001, side, turn);
      const after = sampleFoot(0.00001, side, turn);
      assert.ok(before.position.distanceTo(after.position) < 0.0002, 'foot pops on wrapping phase');
      assert.ok(before.rotation.distanceTo(after.rotation) < 0.0002, 'foot rotation pops on wrapping phase');
    }
  }
});

test('cadence advances monotonically through sudden speed changes at different frame rates', () => {
  for (const dt of [1 / 144, 1 / 60, 1 / 30]) {
    let cycle = 0.9, cadence = 0.9;
    for (let frame = 0; frame < 500; frame++) {
      const next = advanceCycle(cycle, cadence, frame % 7 === 0 ? 17 : 6, dt, true);
      const delta = (next.cycle - cycle + 1) % 1;
      assert.ok(delta > 0 && delta <= dt * 1.36);
      cycle = next.cycle; cadence = next.cadence;
    }
  }
});

test('distance along the track is continuous, with matching tangent at all curve joins', () => {
  const h = STRAIGHT_LENGTH / 2, arc = Math.PI * BEND_RADIUS;
  for (const d of [0, h, h + arc, h + arc + STRAIGHT_LENGTH, h + arc * 2 + STRAIGHT_LENGTH, LAP_LENGTH]) {
    for (const lane of [0, 1, 2]) {
      const before = trackSample(d - 0.00001, lane), after = trackSample(d + 0.00001, lane);
      assert.ok(before.position.distanceTo(after.position) < 0.00003);
      assert.ok(before.tangent.distanceTo(after.tangent) < 0.00001);
      assert.ok(Math.abs(before.corner - after.corner) < 0.00001);
    }
  }
  for (let d = 0; d < LAP_LENGTH; d += 0.13) {
    const a = trackSample(d), b = trackSample(d + 0.01);
    assert.ok(Math.abs(a.position.distanceTo(b.position) - 0.01) < 0.00001);
  }
});
