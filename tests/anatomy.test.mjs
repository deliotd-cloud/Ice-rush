import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lowerBodyGeometry } from '../app/human-anatomy.ts';

const geometry = lowerBodyGeometry();

test('hips, crotch and both legs form one closed, connected surface', () => {
  const edges = new Map();
  const positions = geometry.getAttribute('position');
  const adjacency = Array.from({ length: positions.count }, () => []);
  const triangles = geometry.index.array;
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]];
    assert.notEqual(a, b); assert.notEqual(b, c); assert.notEqual(a, c);
    for (const [from, to] of [[a, b], [b, c], [c, a]]) {
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      adjacency[from].push(to); adjacency[to].push(from);
    }
  }
  for (const count of edges.values()) assert.equal(count, 2, 'open seam or non-manifold edge');
  const visited = new Set([0]), pending = [0];
  while (pending.length) for (const neighbour of adjacency[pending.pop()]) {
    if (!visited.has(neighbour)) { visited.add(neighbour); pending.push(neighbour); }
  }
  assert.equal(visited.size, positions.count, 'disconnected hip or limb');
});

test('surface normals and skin weights remain finite, normalized and within the rig', () => {
  const normals = geometry.getAttribute('normal'), weights = geometry.getAttribute('skinWeight');
  const indices = geometry.getAttribute('skinIndex');
  for (let i = 0; i < normals.count; i++) {
    assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < 0.00001);
    const values = [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)];
    assert.ok(values.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) < 0.00001);
    assert.ok([indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i)].every(value => value >= 0 && value < 8));
  }
});
