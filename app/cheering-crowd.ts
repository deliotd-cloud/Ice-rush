import * as THREE from 'three';

type Spectator = {
  x: number; y: number; z: number; facing: number; size: number;
  phase: number; tempo: number; gesture: number; standing: boolean; sign: boolean;
};

export function createCheeringCrowd(scene: THREE.Scene) {
  const fans: Spectator[] = [];
  let seed = 141;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const coats = [0x315d91, 0xb3464f, 0xd5b777, 0x478379, 0x766896, 0xbccad3, 0x273c54, 0xc17853];
  const skins = [0xe3b58f, 0xc18b67, 0x9a6548, 0x724936, 0xd4a582];
  const hairColors = [0x261d1a, 0x493029, 0x8f6b41, 0xc1aa7a, 0x5e6269];
  for (const side of [-1, 1]) for (let row = 0; row < 5; row++) for (let seat = 0; seat < 80; seat++) {
    // Leave natural gaps and small aisles between groups of supporters.
    if (seat % 20 === 19 || random() < 0.22) continue;
    fans.push({
      x: -26 + seat * 0.66, y: 0.34 + row * 0.44, z: side * (17.05 + row * 1.05), facing: -side,
      size: 0.89 + random() * 0.18, phase: random() * Math.PI * 2, tempo: 0.85 + random() * 0.7,
      gesture: Math.floor(random() * 4), standing: random() < 0.28, sign: random() < 0.035,
    });
  }
  const group = new THREE.Group();
  group.name = 'Cheering spectators';
  scene.add(group);
  const count = fans.length;
  const batches: THREE.InstancedMesh[] = [];
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const makeBatch = (name: string, geometry: THREE.BufferGeometry, capacity = count, customMaterial: THREE.Material = material) => {
    const batch = new THREE.InstancedMesh(geometry, customMaterial, capacity);
    batch.name = name;
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batch.frustumCulled = false;
    group.add(batch);
    batches.push(batch);
    return batch;
  };
  const torso = makeBatch('Jackets', new THREE.LatheGeometry([
    new THREE.Vector2(0.14, 0), new THREE.Vector2(0.17, 0.09), new THREE.Vector2(0.19, 0.32),
    new THREE.Vector2(0.20, 0.42), new THREE.Vector2(0.15, 0.48), new THREE.Vector2(0.068, 0.51),
  ], 12));
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const heads = makeBatch('Faces', sphere);
  const hair = makeBatch('Hair and woolly hats', new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.59));
  const hips = makeBatch('Hips', sphere);
  const hands = makeBatch('Clapping and waving hands', sphere, count * 2);
  const shoes = makeBatch('Shoes', sphere, count * 2);
  const eyes = makeBatch('Eyes', sphere, count * 2);
  const scarves = makeBatch('Scarves', new THREE.BoxGeometry(1, 1, 1));
  const limbs = makeBatch('Arms and legs', new THREE.CylinderGeometry(0.86, 1, 1, 8), count * 8);

  const signCanvas = document.createElement('canvas');
  signCanvas.width = 512; signCanvas.height = 192;
  const ctx = signCanvas.getContext('2d')!;
  ctx.fillStyle = '#f5f1e9'; ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = '#d9364c'; ctx.fillRect(0, 0, 512, 16);
  ctx.fillStyle = '#2456b6'; ctx.fillRect(0, 176, 512, 16);
  ctx.font = 'bold 76px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('DANTE 141', 256, 100);
  const signTexture = new THREE.CanvasTexture(signCanvas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  const signs = makeBatch('Dante supporters', new THREE.PlaneGeometry(0.63, 0.235), fans.filter(f => f.sign).length,
    new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.85, side: THREE.DoubleSide }));

  fans.forEach((fan, index) => {
    const coat = new THREE.Color(coats[Math.floor(random() * coats.length)]);
    const skin = new THREE.Color(skins[Math.floor(random() * skins.length)]);
    const trousers = new THREE.Color([0x263547, 0x3c4652, 0x344c63, 0x4a3f3c][Math.floor(random() * 4)]);
    torso.setColorAt(index, coat);
    heads.setColorAt(index, skin);
    hair.setColorAt(index, new THREE.Color(random() < 0.25 ? coats[Math.floor(random() * coats.length)] : hairColors[Math.floor(random() * hairColors.length)]));
    hips.setColorAt(index, trousers);
    scarves.setColorAt(index, new THREE.Color(index % 3 === 0 ? 0xedebe3 : index % 3 === 1 ? 0xc8424e : 0x3c70b2));
    for (let side = 0; side < 2; side++) {
      hands.setColorAt(index * 2 + side, skin);
      shoes.setColorAt(index * 2 + side, new THREE.Color(0x202830));
      eyes.setColorAt(index * 2 + side, new THREE.Color(0x262127));
      for (let part = 0; part < 4; part++) limbs.setColorAt(index * 8 + side * 4 + part, part < 2 ? coat : trousers);
    }
  });

  const transform = new THREE.Object3D();
  const direction = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const start = new THREE.Vector3(), end = new THREE.Vector3();
  let elapsed = 0;

  const place = (batch: THREE.InstancedMesh, index: number, fan: Spectator, x: number, y: number, z: number,
    sx: number, sy: number, sz: number, roll = 0) => {
    transform.position.set(fan.x + x * fan.size * fan.facing, fan.y + y * fan.size, fan.z + z * fan.size * fan.facing);
    transform.rotation.set(0, fan.facing === 1 ? 0 : Math.PI, roll);
    transform.scale.set(sx * fan.size, sy * fan.size, sz * fan.size);
    transform.updateMatrix();
    batch.setMatrixAt(index, transform.matrix);
  };
  const segment = (index: number, fan: Spectator, ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number) => {
    start.set(fan.x + ax * fan.size * fan.facing, fan.y + ay * fan.size, fan.z + az * fan.size * fan.facing);
    end.set(fan.x + bx * fan.size * fan.facing, fan.y + by * fan.size, fan.z + bz * fan.size * fan.facing);
    direction.copy(end).sub(start);
    transform.position.copy(start).add(end).multiplyScalar(0.5);
    transform.scale.set(radius * fan.size, direction.length(), radius * fan.size);
    transform.quaternion.setFromUnitVectors(up, direction.normalize());
    transform.updateMatrix();
    limbs.setMatrixAt(index, transform.matrix);
  };

  const update = (dt: number, skaterPosition: THREE.Vector3, racing: boolean) => {
    elapsed += dt;
    let signIndex = 0;
    fans.forEach((fan, i) => {
      const t = elapsed * fan.tempo + fan.phase;
      const distance = Math.hypot(fan.x - skaterPosition.x, fan.z - skaterPosition.z);
      const excitement = racing ? 0.55 + 0.45 * Math.max(0, 1 - distance / 20) : 0.28;
      const bob = (0.5 + 0.5 * Math.sin(t * 3.4)) * (fan.standing ? 0.033 : 0.012) * excitement;
      const hip = (fan.standing ? 0.90 : 0.58) + bob;
      const sway = Math.sin(t * 1.3) * 0.017 * excitement;
      place(torso, i, fan, sway, hip, 0, 1, 1, 0.8);
      place(hips, i, fan, sway, hip, 0, 0.15, 0.115, 0.12);
      place(heads, i, fan, sway, hip + 0.66, 0.025, 0.105, 0.139, 0.104);
      place(hair, i, fan, sway, hip + 0.697, 0.015, 0.115, 0.13, 0.113);
      place(scarves, i, fan, sway - 0.05, hip + 0.37, 0.116, 0.065, 0.25, 0.015);
      for (const side of [-1, 1]) {
        const s = side === -1 ? 0 : 1;
        const base = i * 8 + s * 4;
        let handX: number, handY: number, handZ: number;
        const clap = 0.5 + 0.5 * Math.sin(t * 6.6);
        if (fan.sign) {
          handX = side * 0.29; handY = hip + 0.98 + Math.sin(t * 2) * 0.025; handZ = 0.15;
        } else if (fan.gesture === 0 || (fan.gesture === 1 && side === -1)) {
          handX = side * (0.025 + clap * 0.12);
          handY = hip + 0.40 + Math.sin(t * 2.1) * 0.025; handZ = 0.34;
        } else if (fan.gesture === 1 || fan.gesture === 2) {
          handX = side * (0.22 + Math.sin(t * 3 + side) * 0.075 * excitement);
          handY = hip + 0.99 + Math.sin(t * 3.3 + side) * 0.065 * excitement; handZ = 0.07;
        } else {
          handX = side * 0.24; handY = hip + 0.61 + Math.sin(t * 4 + side) * 0.14 * excitement; handZ = 0.25;
        }
        const shoulderY = hip + 0.42;
        const elbowX = side * 0.25;
        const elbowY = (shoulderY + handY) * 0.5 - 0.065;
        const elbowZ = handY > hip + 0.7 ? 0.035 : 0.15;
        segment(base, fan, sway + side * 0.18, shoulderY, 0, elbowX, elbowY, elbowZ, 0.051);
        segment(base + 1, fan, elbowX, elbowY, elbowZ, handX, handY, handZ, 0.042);
        place(hands, i * 2 + s, fan, handX, handY, handZ, 0.037, 0.05, 0.025, side * 0.3);
        const kneeY = fan.standing ? 0.49 : 0.46;
        const kneeZ = fan.standing ? 0.045 : 0.31;
        const footZ = fan.standing ? 0.055 : 0.33;
        segment(base + 2, fan, side * 0.09, hip, 0, side * 0.11, kneeY, kneeZ, 0.072);
        segment(base + 3, fan, side * 0.11, kneeY, kneeZ, side * 0.11, 0.09, footZ, 0.051);
        place(shoes, i * 2 + s, fan, side * 0.11, 0.068, footZ + 0.055, 0.065, 0.044, 0.125);
        place(eyes, i * 2 + s, fan, sway + side * 0.039, hip + 0.678, 0.122, 0.012, 0.011, 0.009);
      }
      if (fan.sign) place(signs, signIndex++, fan, 0, hip + 1.015 + Math.sin(t * 2) * 0.025, 0.17, 1, 1, 1, Math.sin(t * 1.4) * 0.04);
    });
    batches.forEach(batch => { batch.instanceMatrix.needsUpdate = true; });
  };
  update(0, new THREE.Vector3(), false);
  return { update, count };
}
