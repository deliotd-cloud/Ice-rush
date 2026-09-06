import * as THREE from 'three';
import { advanceCycle, ARM_LENGTHS, ICE_HEIGHT, LEG_LENGTHS, limbRotations, sampleSkatingPose, type LimbPose, type SkatingPose } from './skating-motion';
import { lowerBodyGeometry } from './human-anatomy';

type SkinLimb = { mesh: THREE.SkinnedMesh; upper: THREE.Bone; lower: THREE.Bone; joint: THREE.Bone };
type LegBones = { upper: THREE.Bone; lower: THREE.Bone; joint: THREE.Bone };
export type SkaterModel = THREE.Group & { userData: {
  rig: {
    pelvis: THREE.Bone; waist: THREE.Bone; torso: THREE.Group; head: THREE.Group;
    arms: SkinLimb[]; legs: LegBones[]; gloves: THREE.Group[]; boots: THREE.Group[];
    cycle: number; cadence: number; corner: number; idle: number; effort: number;
    pose: SkatingPose | null;
  };
} };

function surface(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D) {
  const part = new THREE.Mesh(geometry, material);
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}

function oval(parent: THREE.Object3D, material: THREE.Material, size: [number, number, number], position: [number, number, number]) {
  const part = surface(new THREE.SphereGeometry(1, 32, 24), material, parent);
  part.scale.set(...size);
  part.position.set(...position);
  return part;
}

// Small repeatable normal/roughness variations read as woven Lycra in close views.
function fabricTexture() {
  const data = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4;
    const weave = Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2);
    data[i] = data[i + 1] = data[i + 2] = 205 + weave * 35;
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 64, 64);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 16);
  texture.needsUpdate = true;
  return texture;
}

function printedText(text: string, width: number, height: number, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 118px Arial';
  ctx.fillText(text, 256, 140);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
}

function limbSkin(parent: THREE.Group, lengths: readonly [number, number], material: THREE.Material, primary: THREE.Color, blue: THREE.Color, leg: boolean) {
  const total = lengths[0] + lengths[1];
  const ringCount = 56;
  const sides = 32;
  const positions: number[] = [], colors: number[] = [], uv: number[] = [], indices: number[] = [];
  const skinIndices: number[] = [], weights: number[] = [];
  const white = new THREE.Color(0xf4f5f0);
  const dark = new THREE.Color(0x10243b);
  const profile = leg ? [0.057, 0.088, 0.089, 0.079, 0.066, 0.064, 0.065, 0.055, 0.045] : [0.039, 0.057, 0.055, 0.049, 0.046, 0.044, 0.041, 0.035, 0.030];
  for (let ring = 0; ring <= ringCount; ring++) {
    const t = ring / ringCount;
    const p = t * (profile.length - 1);
    const idx = Math.min(profile.length - 2, Math.floor(p));
    const radius = THREE.MathUtils.lerp(profile[idx], profile[idx + 1], THREE.MathUtils.smoothstep(p - idx, 0, 1));
    const lowerWeight = THREE.MathUtils.smoothstep(t * total, lengths[0] - 0.065, lengths[0] + 0.065);
    const jointWeight = 1 - THREE.MathUtils.smoothstep(Math.abs(t * total - lengths[0]), 0.005, 0.075);
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      positions.push(Math.cos(angle) * radius, -t * total, Math.sin(angle) * radius * (leg ? 0.94 : 1));
      let color = blue.clone();
      if (leg) color.lerp(dark, THREE.MathUtils.smoothstep(t, 0.68, 0.94));
      else color = t < 0.30 ? primary.clone() : t < 0.37 ? white.clone() : blue.clone();
      // Two fine side seams, inset into the surface rather than floating geometry.
      if (side === 0 || side === 16) color.multiplyScalar(0.62);
      colors.push(color.r, color.g, color.b);
      uv.push(side / sides, t);
      skinIndices.push(0, 1, 2, 0);
      weights.push((1 - lowerWeight) * (1 - jointWeight), lowerWeight * (1 - jointWeight), jointWeight, 0);
      if (ring < ringCount && side < sides) {
        const a = ring * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const upper = new THREE.Bone();
  const lower = new THREE.Bone();
  const joint = new THREE.Bone();
  lower.position.y = -lengths[0];
  joint.position.y = -lengths[0];
  upper.add(lower);
  const skin = new THREE.SkinnedMesh(geometry, material);
  skin.add(upper, joint);
  skin.bind(new THREE.Skeleton([upper, lower, joint]));
  skin.castShadow = skin.receiveShadow = true;
  // Bounds change with the pose; only four athletes are present in the scene.
  skin.frustumCulled = false;
  parent.add(skin);
  return { mesh: skin, upper, lower, joint };
}

function updateSkin(limb: SkinLimb, pose: LimbPose) {
  const q = limbRotations(pose);
  limb.upper.position.copy(pose.start);
  limb.upper.quaternion.copy(q.upper);
  limb.lower.quaternion.copy(q.lower);
  limb.joint.position.copy(pose.joint);
  limb.joint.quaternion.copy(q.upper).slerp(q.upper.clone().multiply(q.lower), 0.5);
}

export function buildDetailedSkater(primaryColor: number, accentColor: number, dante = false, identity?: { name: string; number: number }): SkaterModel {
  const racerName = identity?.name ?? (dante ? 'Dante' : '');
  const raceNumber = identity?.number ?? (dante ? 141 : primaryColor % 200 + 20);
  const root = new THREE.Group() as SkaterModel;
  const primary = new THREE.Color(primaryColor), blue = new THREE.Color(accentColor);
  const fabric = fabricTexture();
  const suit = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, roughnessMap: fabric,
    bumpMap: fabric, bumpScale: 0.00055, sheen: 0.4, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xadc7dc), clearcoat: 0.08 });
  const blueSuit = suit.clone();
  blueSuit.vertexColors = false;
  blueSuit.color.copy(blue);
  const white = new THREE.MeshPhysicalMaterial({ color: 0xebece5, roughness: 0.48, sheen: 0.3 });
  const skin = new THREE.MeshPhysicalMaterial({ color: dante ? 0xc99070 : 0xa36c50, roughness: 0.62, sheen: 0.12 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.42 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x172128, roughness: 0.36, metalness: 0.38, roughnessMap: fabric });
  const steel = new THREE.MeshStandardMaterial({ color: 0xe4eef0, metalness: 1, roughness: 0.18 });

  const pelvis = new THREE.Bone();
  const waist = new THREE.Bone();
  pelvis.add(waist);
  const legs: LegBones[] = [-1, 1].map(side => {
    const upper = new THREE.Bone(), lower = new THREE.Bone(), joint = new THREE.Bone();
    upper.position.set(side * 0.108, -0.015, 0);
    lower.position.y = -LEG_LENGTHS[0];
    joint.position.set(side * 0.108, -0.015 - LEG_LENGTHS[0], 0);
    upper.add(lower);
    pelvis.add(upper, joint);
    return { upper, lower, joint };
  });
  const pantsMaterial = blueSuit.clone();
  pantsMaterial.vertexColors = true;
  const pants = new THREE.SkinnedMesh(lowerBodyGeometry(), pantsMaterial);
  pants.name = 'Continuous hips and legs';
  pants.add(pelvis);
  pants.bind(new THREE.Skeleton([pelvis, legs[0].upper, legs[0].lower, legs[1].upper, legs[1].lower, waist, legs[0].joint, legs[1].joint]));
  pants.castShadow = pants.receiveShadow = true;
  pants.frustumCulled = false;
  root.add(pants);
  const torso = new THREE.Group();
  const profile = new THREE.SplineCurve([
    new THREE.Vector2(0.137, 0), new THREE.Vector2(0.134, 0.10), new THREE.Vector2(0.146, 0.24),
    new THREE.Vector2(0.177, 0.36), new THREE.Vector2(0.198, 0.44), new THREE.Vector2(0.150, 0.49), new THREE.Vector2(0.064, 0.535),
  ]);
  const torsoGeometry = new THREE.LatheGeometry(profile.getPoints(64), 64);
  const pos = torsoGeometry.getAttribute('position');
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), x = pos.getX(i), z = pos.getZ(i);
    pos.setZ(i, z * 0.58);
    const c = y < 0.205 ? blue.clone() : y < 0.236 ? new THREE.Color(0xeff1ee) : primary.clone();
    if (Math.abs(x) > 0.97 * Math.hypot(x, z)) c.multiplyScalar(0.75);
    colors.push(c.r, c.g, c.b);
  }
  torsoGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  torsoGeometry.computeVertexNormals();
  surface(torsoGeometry, suit, torso);
  const neck = oval(torso, skin, [0.056, 0.088, 0.056], [0, 0.55, 0]);
  neck.rotation.x = -0.1;
  const collar = surface(new THREE.CylinderGeometry(0.066, 0.070, 0.043, 32, 1, true), blueSuit, torso);
  collar.position.y = 0.53;
  // The zipper follows the curved front of the suit.
  const zipPoints = profile.getPoints(64).map((p) => new THREE.Vector3(0, p.y, p.x * 0.58 + 0.002));
  surface(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(zipPoints), 64, 0.0026, 5, false), white, torso);
  if (racerName) {
    const label = printedText(racerName.toUpperCase(), 0.210, 0.09);
    label.position.set(0, 0.32, -0.100);
    label.rotation.y = Math.PI;
    torso.add(label);
    const chest = printedText(String(raceNumber), 0.084, 0.046);
    chest.position.set(0.089, 0.36, 0.092);
    torso.add(chest);
  }
  root.add(torso);

  const head = new THREE.Group();
  head.scale.set(0.94, 0.98, 0.96);
  // Narrow jaw, cheek plane and longer nose preserve the reference's face shape.
  const faceProfile = new THREE.SplineCurve([
    new THREE.Vector2(0.043, -0.127), new THREE.Vector2(0.076, -0.10),
    new THREE.Vector2(0.108, -0.045), new THREE.Vector2(0.112, 0.023),
    new THREE.Vector2(0.105, 0.09), new THREE.Vector2(0.04, 0.139), new THREE.Vector2(0.001, 0.145),
  ]);
  const faceGeometry = new THREE.LatheGeometry(faceProfile.getPoints(40), 48);
  faceGeometry.scale(1, 1, 0.94);
  surface(faceGeometry, skin, head);
  oval(head, skin, [0.024, 0.034, 0.030], [0, -0.028, 0.115]);
  oval(head, skin, [0.014, 0.033, 0.019], [0, -0.001, 0.107]);
  oval(head, new THREE.MeshStandardMaterial({ color: 0x915a49, roughness: 0.7 }), [0.034, 0.005, 0.006], [0, -0.075, 0.092]);
  for (const side of [-1, 1]) {
    oval(head, skin, [0.022, 0.038, 0.023], [side * 0.111, -0.01, -0.004]);
    const strap = surface(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.123, 0.061, 0.005), new THREE.Vector3(side * 0.091, -0.09, 0.01), new THREE.Vector3(side * 0.036, -0.134, 0.045),
    ]), 16, 0.005, 6, false), dark, head);
    strap.castShadow = false;
  }

  const helmetMaterial = new THREE.MeshPhysicalMaterial({ color: blue, roughness: 0.34, clearcoat: 0.32, clearcoatRoughness: 0.35 });
  const helmet = surface(new THREE.SphereGeometry(0.146, 64, 36, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMaterial, head);
  helmet.scale.set(0.94, 0.78, 1.03);
  helmet.position.set(0, 0.068, -0.012);
  const rim = surface(new THREE.TorusGeometry(0.139, 0.003, 6, 64), dark, head);
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(0.94, 1.03, 1);
  rim.position.set(0, 0.051, -0.012);
  for (const side of [-1, 1]) {
    const number = printedText(String(raceNumber), 0.123, 0.068);
    number.position.set(side * 0.133, 0.099, -0.008);
    number.rotation.y = side * Math.PI / 2;
    head.add(number);
  }

  const lensMaterial = new THREE.MeshPhysicalMaterial({ color: dante ? 0xb98119 : 0x4384a4, metalness: 0.94, roughness: 0.095,
    clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.48, iridescenceIOR: 1.45 });
  const lensPositions: number[] = [], lensIndices: number[] = [];
  for (let row = 0; row < 2; row++) for (let i = 0; i <= 32; i++) {
    const a = -1.13 + i / 32 * 2.26;
    lensPositions.push(Math.sin(a) * 0.126, 0.042 - row * (0.052 - Math.abs(a) * 0.009), Math.cos(a) * 0.126 + 0.007);
    if (row === 0 && i < 32) lensIndices.push(i, i + 33, i + 1, i + 1, i + 33, i + 34);
  }
  const lensGeometry = new THREE.BufferGeometry();
  lensGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lensPositions, 3));
  lensGeometry.setIndex(lensIndices);
  lensGeometry.computeVertexNormals();
  surface(lensGeometry, lensMaterial, head);
  const framePoints = Array.from({ length: 33 }, (_, i) => {
    const a = -1.2 + i / 32 * 2.4;
    return new THREE.Vector3(Math.sin(a) * 0.127, 0.044, Math.cos(a) * 0.127 + 0.007);
  });
  surface(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(framePoints), 32, 0.005, 6, false), dark, head);

  if (dante) {
    const hairMaterial = new THREE.MeshStandardMaterial({ color: 0x18100e, roughness: 0.89 });
    const curls = new THREE.InstancedMesh(new THREE.TorusGeometry(0.014, 0.0075, 7, 12), hairMaterial, 144);
    const transform = new THREE.Object3D();
    for (let i = 0; i < 144; i++) {
      const angle = 0.89 + (i % 24) / 23 * (Math.PI * 2 - 1.78);
      const row = Math.floor(i / 24);
      const radius = 0.119 + Math.sin(i * 7.83) * 0.009;
      transform.position.set(Math.sin(angle) * radius, 0.039 - row * 0.024, Math.cos(angle) * radius - 0.009);
      transform.rotation.set(i * 1.97, angle, i * 0.713);
      transform.scale.setScalar(0.8 + (Math.sin(i * 3.13) + 1) * 0.22);
      transform.updateMatrix();
      curls.setMatrixAt(i, transform.matrix);
    }
    curls.castShadow = true;
    head.add(curls);
    for (const side of [-1, 1]) {
      const moustache = oval(head, hairMaterial, [0.027, 0.006, 0.005], [side * 0.02, -0.062, 0.1]);
      moustache.rotation.z = side * -0.13;
    }
  }
  root.add(head);

  const arms = [limbSkin(root, ARM_LENGTHS, suit, primary, blue, false), limbSkin(root, ARM_LENGTHS, suit, primary, blue, false)];
  const gloves = [-1, 1].map((side) => {
    const glove = new THREE.Group();
    glove.scale.set(0.90, 0.94, 0.90);
    oval(glove, white, [0.035, 0.04, 0.02], [0, -0.012, 0]);
    for (let finger = 0; finger < 4; finger++) {
      const x = (finger - 1.5) * 0.014;
      oval(glove, white, [0.008, 0.025 - Math.abs(finger - 1.3) * 0.003, 0.008], [x, -0.054, 0]);
      oval(glove, dark, [0.0082, 0.009, 0.0082], [x, -0.073 + Math.abs(finger - 1.3) * 0.005, 0.001]);
    }
    const thumb = oval(glove, white, [0.010, 0.025, 0.01], [side * 0.032, -0.019, 0.004]);
    thumb.rotation.z = side * -0.45;
    root.add(glove);
    return glove;
  });

  const boots = [-1, 1].map(() => {
    const boot = new THREE.Group();
    boot.scale.x = 0.90;
    oval(boot, carbon, [0.082, 0.044, 0.176], [0, 0.083, 0.023]);
    oval(boot, white, [0.08, 0.049, 0.169], [0, 0.112, 0.031]);
    oval(boot, white, [0.063, 0.058, 0.073], [0, 0.155, -0.06]);
    for (const z of [-0.031, 0.027, 0.077]) {
      const strap = surface(new THREE.BoxGeometry(0.142, 0.016, 0.026), dark, boot);
      strap.position.set(0, 0.154 - Math.max(0, z) * 0.28, z);
      const buckle = surface(new THREE.BoxGeometry(0.023, 0.012, 0.032), steel, boot);
      buckle.position.set(0.058, strap.position.y + 0.008, z);
    }
    for (const z of [-0.1, 0.125]) {
      const tower = surface(new THREE.BoxGeometry(0.016, 0.045, 0.025), steel, boot);
      tower.position.set(0, 0.049, z);
    }
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(-0.285, 0.033);
    for (let i = 0; i <= 48; i++) {
      const z = -0.285 + i / 48 * 0.57;
      bladeShape.lineTo(z, 0.002 + 0.021 * Math.pow(Math.abs(z) / 0.285, 6));
    }
    bladeShape.lineTo(0.285, 0.047);
    bladeShape.lineTo(-0.285, 0.047);
    bladeShape.closePath();
    const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.003, bevelEnabled: false, steps: 1 });
    bladeGeometry.translate(0, 0, -0.0015);
    bladeGeometry.rotateY(-Math.PI / 2);
    surface(bladeGeometry, steel, boot);
    root.add(boot);
    return boot;
  });
  root.userData.rig = { pelvis, waist, torso, head, arms, legs, gloves, boots, cycle: dante ? 0.05 : (primaryColor % 100) / 100,
    cadence: 0.9, corner: 0, idle: 1, effort: 0, pose: null };
  return root;
}

export function animateDetailedSkater(model: SkaterModel, dt: number, speed: number, turn: number, moving: boolean, effort: number) {
  const rig = model.userData.rig;
  const clock = advanceCycle(rig.cycle, rig.cadence, speed, dt, moving);
  rig.cycle = clock.cycle;
  rig.cadence = clock.cadence;
  rig.corner = THREE.MathUtils.damp(rig.corner, moving ? turn : 0, 6, dt);
  rig.idle = THREE.MathUtils.damp(rig.idle, moving ? 0 : 1, moving ? 3.8 : 1.8, dt);
  rig.effort = THREE.MathUtils.damp(rig.effort, effort, 4, dt);
  const pose = sampleSkatingPose(rig.cycle, rig.corner, rig.effort, rig.idle);
  rig.pose = pose;
  rig.pelvis.position.copy(pose.pelvis);
  rig.pelvis.rotation.set(0, 0, 0);
  rig.waist.quaternion.copy(pose.torso);
  rig.torso.position.copy(pose.pelvis);
  rig.torso.quaternion.copy(pose.torso);
  rig.head.position.copy(pose.head);
  rig.head.rotation.set(pose.headRotation.x, pose.headRotation.y, pose.headRotation.z);
  for (let i = 0; i < 2; i++) {
    const leg = rig.legs[i], legPose = pose.legs[i];
    const legRotation = limbRotations(legPose);
    leg.upper.position.copy(legPose.start).sub(pose.pelvis);
    leg.upper.quaternion.copy(legRotation.upper);
    leg.lower.quaternion.copy(legRotation.lower);
    leg.joint.position.copy(legPose.joint).sub(pose.pelvis);
    leg.joint.quaternion.copy(legRotation.upper).slerp(legRotation.upper.clone().multiply(legRotation.lower), 0.5);
    updateSkin(rig.arms[i], pose.arms[i]);
    const foot = pose.feet[i];
    rig.boots[i].position.copy(foot.position);
    rig.boots[i].rotation.set(foot.rotation.x, foot.rotation.y, foot.rotation.z);
    rig.gloves[i].position.copy(pose.arms[i].end);
    rig.gloves[i].quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), pose.arms[i].end.clone().sub(pose.arms[i].joint).normalize());
    if (i === 0 && rig.corner > 0.4) rig.gloves[i].rotation.x = THREE.MathUtils.lerp(rig.gloves[i].rotation.x, -1.45, rig.corner);
  }
  model.position.y = ICE_HEIGHT;
  model.rotation.z = 0;
}
