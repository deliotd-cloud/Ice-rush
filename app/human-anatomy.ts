import * as THREE from 'three';

// A single joined surface across the waist, glutes, crotch and both legs.
// Smooth distance-field blending avoids intersecting hip and thigh primitives.
let cachedLowerBody: THREE.BufferGeometry | null = null;

export function lowerBodyGeometry() {
  if (cachedLowerBody) return cachedLowerBody.clone();
  const profile = [0.057, 0.088, 0.089, 0.079, 0.066, 0.064, 0.065, 0.055, 0.045];
  const blend = (a: number, b: number, radius: number) => {
    const h = Math.max(radius - Math.abs(a - b), 0) / radius;
    return Math.min(a, b) - h * h * radius * 0.25;
  };
  const ellipsoid = (x: number, y: number, z: number, rx: number, ry: number, rz: number) =>
    (Math.hypot(x / rx, y / ry, z / rz) - 1) * Math.min(rx, ry, rz);
  const field = (x: number, y: number, z: number) => {
    let value = ellipsoid(x, y + 0.007, z + 0.006, 0.136, 0.112, 0.089);
    // Subtle paired glute contours, flatter above and softly rounded below.
    for (const side of [-1, 1]) {
      value = blend(value, ellipsoid(x - side * 0.064, y + 0.051, z + 0.041, 0.077, 0.084, 0.065), 0.035);
      const along = THREE.MathUtils.clamp((-y - 0.015) / 0.905, 0, 1);
      const sample = along * (profile.length - 1);
      const index = Math.min(profile.length - 2, Math.floor(sample));
      const t = THREE.MathUtils.smoothstep(sample - index, 0, 1);
      const radius = THREE.MathUtils.lerp(profile[index], profile[index + 1], t);
      const axisY = THREE.MathUtils.clamp(y, -0.92, -0.015);
      const leg = Math.hypot(x - side * 0.108, (y - axisY), z / 0.94) - radius;
      value = blend(value, leg, 0.042);
    }
    return value;
  };

  const nx = 40, ny = 94, nz = 32;
  const min = new THREE.Vector3(-0.235, -0.985, -0.16);
  const size = new THREE.Vector3(0.47, 1.13, 0.32);
  const at = (x: number, y: number, z: number) => (x * (ny + 1) + y) * (nz + 1) + z;
  const values = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  for (let x = 0; x <= nx; x++) for (let y = 0; y <= ny; y++) for (let z = 0; z <= nz; z++) {
    values[at(x, y, z)] = field(min.x + x / nx * size.x, min.y + y / ny * size.y, min.z + z / nz * size.z);
  }
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], uvs: number[] = [];
  const skinIndices: number[] = [], weights: number[] = [], triangles: number[] = [];
  const dedup = new Map<string, number>();
  const corners = [[0,0,0], [1,0,0], [1,1,0], [0,1,0], [0,0,1], [1,0,1], [1,1,1], [0,1,1]];
  const tetrahedra = [[0,5,1,6], [0,1,2,6], [0,2,3,6], [0,3,7,6], [0,7,4,6], [0,4,5,6]];
  const p = Array.from({ length: 8 }, () => new THREE.Vector3());
  const v = new Float32Array(8);
  const normal = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const vertex = (a: number, b: number) => {
    const t = v[a] / (v[a] - v[b]);
    const x = THREE.MathUtils.lerp(p[a].x, p[b].x, t);
    const y = THREE.MathUtils.lerp(p[a].y, p[b].y, t);
    const z = THREE.MathUtils.lerp(p[a].z, p[b].z, t);
    const key = `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
    const old = dedup.get(key);
    if (old !== undefined) return old;
    const i = positions.length / 3;
    dedup.set(key, i);
    positions.push(x, y, z);
    const e = 0.0005;
    normal.set(field(x + e, y, z) - field(x - e, y, z), field(x, y + e, z) - field(x, y - e, z), field(x, y, z + e) - field(x, y, z - e)).normalize();
    normals.push(normal.x, normal.y, normal.z);
    const shade = THREE.MathUtils.lerp(1, 0.24, THREE.MathUtils.smoothstep(-y, 0.66, 0.93));
    colors.push(shade, shade, shade);
    uvs.push(Math.atan2(z, x - (x < 0 ? -0.108 : 0.108)) / (Math.PI * 2) + 0.5, -y);
    const legWeight = THREE.MathUtils.smoothstep(-y, 0.01, 0.19);
    const waistWeight = (1 - legWeight) * THREE.MathUtils.smoothstep(y, -0.055, 0.075);
    const kneeDistance = -y - 0.475;
    const lower = THREE.MathUtils.smoothstep(kneeDistance, -0.085, 0.085);
    const knee = 1 - THREE.MathUtils.smoothstep(Math.abs(kneeDistance), 0.008, 0.1);
    const upperIndex = x < 0 ? 1 : 3, lowerIndex = x < 0 ? 2 : 4, kneeIndex = x < 0 ? 6 : 7;
    if (legWeight > 0.999) {
      skinIndices.push(upperIndex, lowerIndex, kneeIndex, 0);
      weights.push((1 - lower) * (1 - knee), lower * (1 - knee), knee, 0);
    } else {
      const rightSide = THREE.MathUtils.smoothstep(x, -0.035, 0.035);
      skinIndices.push(0, 1, 3, 5);
      weights.push(1 - legWeight - waistWeight, legWeight * (1 - rightSide), legWeight * rightSide, waistWeight);
    }
    return i;
  };
  const triangle = (a: number, b: number, c: number) => {
    if (a === b || b === c || a === c) return;
    ab.set(positions[b * 3] - positions[a * 3], positions[b * 3 + 1] - positions[a * 3 + 1], positions[b * 3 + 2] - positions[a * 3 + 2]);
    ac.set(positions[c * 3] - positions[a * 3], positions[c * 3 + 1] - positions[a * 3 + 1], positions[c * 3 + 2] - positions[a * 3 + 2]);
    normal.fromArray(normals, a * 3);
    if (ab.cross(ac).dot(normal) < 0) triangles.push(a, c, b);
    else triangles.push(a, b, c);
  };
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    let insideCount = 0;
    corners.forEach(([dx, dy, dz], i) => {
      v[i] = values[at(x + dx, y + dy, z + dz)];
      if (v[i] < 0) insideCount++;
      p[i].set(min.x + (x + dx) / nx * size.x, min.y + (y + dy) / ny * size.y, min.z + (z + dz) / nz * size.z);
    });
    if (insideCount === 0 || insideCount === 8) continue;
    for (const tetra of tetrahedra) {
      const inside = tetra.filter(i => v[i] < 0), outside = tetra.filter(i => v[i] >= 0);
      if (inside.length === 1) triangle(vertex(inside[0], outside[0]), vertex(inside[0], outside[1]), vertex(inside[0], outside[2]));
      else if (inside.length === 3) triangle(vertex(outside[0], inside[0]), vertex(outside[0], inside[1]), vertex(outside[0], inside[2]));
      else if (inside.length === 2) {
        const a = vertex(inside[0], outside[0]), b = vertex(inside[0], outside[1]);
        const c = vertex(inside[1], outside[0]), d = vertex(inside[1], outside[1]);
        triangle(a, b, c); triangle(b, d, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex(triangles);
  cachedLowerBody = geometry;
  return geometry.clone();
}
