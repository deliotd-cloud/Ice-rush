import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { BEND_RADIUS, STRAIGHT_LENGTH, trackPoints, trackSample } from './ice-track';
import type { SkaterModel } from './skater-model';
import { createCheeringCrowd } from './cheering-crowd';

function box(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  object.position.set(...position);
  object.castShadow = object.receiveShadow = true;
  parent.add(object);
  return object;
}

function rinkShape(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const x = -width / 2, y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function iceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#aab7be';
  ctx.fillRect(0, 0, 1024, 1024);
  let seed = 1329;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 6500; i++) {
    const x = random() * 1024, y = random() * 1024;
    ctx.strokeStyle = `rgba(240,250,255,${0.03 + random() * 0.14})`;
    ctx.lineWidth = random() < 0.96 ? 0.5 : 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 4, y + 15, x + (random() - 0.5) * 40, y + 20 + random() * 70);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.10, 0.10);
  texture.anisotropy = 8;
  return texture;
}

export function createIceArena(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  scene.background = new THREE.Color(0x101925);
  scene.fog = new THREE.Fog(0x101925, 36, 87);
  const environmentScene = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(environmentScene, 0.05);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.4;
  environmentScene.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xcfe5ff, 0x5a6975, 1.6));
  const key = new THREE.DirectionalLight(0xfff4e7, 3.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -8;
  key.shadow.camera.right = key.shadow.camera.top = 8;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 32;
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 2;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9ecfff, 1.5);
  rim.position.set(8, 5, -12);
  scene.add(rim);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 90), new THREE.MeshStandardMaterial({ color: 0x162331, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.16;
  scene.add(floor);
  const shape = rinkShape(60, 30, 7.5);
  const iceGeometry = new THREE.ShapeGeometry(shape, 64);
  const reflection = new Reflector(iceGeometry.clone(), { color: 0x8a9da8, textureWidth: 1024, textureHeight: 768, clipBias: 0.002, multisample: 2 });
  reflection.rotation.x = -Math.PI / 2;
  reflection.position.y = 0.017;
  scene.add(reflection);
  const scratches = iceTexture();
  const ice = new THREE.Mesh(iceGeometry, new THREE.MeshPhysicalMaterial({ color: 0xcadfe5, metalness: 0.06, roughness: 0.27,
    roughnessMap: scratches, bumpMap: scratches, bumpScale: 0.004, clearcoat: 0.65, clearcoatRoughness: 0.2,
    transparent: true, opacity: 0.83, depthWrite: false }));
  ice.rotation.x = -Math.PI / 2;
  ice.position.y = 0.023;
  ice.receiveShadow = true;
  scene.add(ice);

  // Actual safety pads along a complete ice sheet, with the race markers inside.
  const padMaterial = new THREE.MeshStandardMaterial({ color: 0x17477f, roughness: 0.66 });
  const white = new THREE.MeshStandardMaterial({ color: 0xdbe2e6, roughness: 0.52 });
  const boundary = shape.getSpacedPoints(152);
  const pads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.98, 0.28), padMaterial, boundary.length - 1);
  const matrix = new THREE.Object3D();
  for (let i = 0; i < boundary.length - 1; i++) {
    const p = boundary[i], next = boundary[i + 1];
    matrix.position.set(p.x, 0.43, -p.y);
    matrix.rotation.y = Math.atan2(next.y - p.y, next.x - p.x);
    matrix.updateMatrix();
    pads.setMatrixAt(i, matrix.matrix);
  }
  pads.receiveShadow = pads.castShadow = true;
  scene.add(pads);
  const railPath = new THREE.CatmullRomCurve3(boundary.slice(0, -1).map(p => new THREE.Vector3(p.x, 0.97, -p.y)), true);
  const rail = new THREE.Mesh(new THREE.TubeGeometry(railPath, 256, 0.036, 8, true), white);
  scene.add(rail);

  const trace = new THREE.Line(new THREE.BufferGeometry().setFromPoints(trackPoints(1, 0.03)),
    new THREE.LineDashedMaterial({ color: 0x5c93a9, transparent: true, opacity: 0.19, dashSize: 0.3, gapSize: 0.55 }));
  trace.computeLineDistances();
  scene.add(trace);
  const markerMaterial = new THREE.MeshStandardMaterial({ color: 0x101921, roughness: 0.62 });
  const arc = Math.PI * BEND_RADIUS;
  for (const offset of [STRAIGHT_LENGTH / 2, STRAIGHT_LENGTH * 1.5 + arc]) {
    for (let i = 0; i <= 6; i++) {
      const p = trackSample(offset + i / 6 * arc, -0.5);
      const marker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.068, 5), markerMaterial);
      marker.position.copy(p.position).setY(0.055);
      scene.add(marker);
    }
  }
  const start = box(scene, [0.06, 0.003, 5.7], [0, 0.033, -BEND_RADIUS], new THREE.MeshBasicMaterial({ color: 0x9d3042 }));
  start.castShadow = false;
  const centerCircle = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.025, 96), new THREE.MeshBasicMaterial({ color: 0x34637b, transparent: true, opacity: 0.18 }));
  centerCircle.rotation.x = -Math.PI / 2;
  centerCircle.position.y = 0.03;
  scene.add(centerCircle);

  const concrete = new THREE.MeshStandardMaterial({ color: 0x243241, roughness: 0.85 });
  const seatGeometry = new THREE.BoxGeometry(0.47, 0.36, 0.42);
  const seating = new THREE.InstancedMesh(seatGeometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 }), 800);
  let seatIndex = 0;
  for (const side of [-1, 1]) for (let row = 0; row < 5; row++) {
    box(scene, [56, 0.48 + row * 0.44, 1.2], [0, row * 0.22 + 0.1, side * (17.2 + row * 1.05)], concrete);
    for (let seat = 0; seat < 80; seat++) {
      matrix.position.set(-26 + seat * 0.66, 0.68 + row * 0.44, side * (17.05 + row * 1.05));
      matrix.rotation.set(0, side === -1 ? 0 : Math.PI, 0);
      matrix.updateMatrix();
      seating.setMatrixAt(seatIndex, matrix.matrix);
      seating.setColorAt(seatIndex++, new THREE.Color(Math.floor(seat / 16) % 2 === 0 ? 0x842f40 : 0x285c87));
    }
  }
  scene.add(seating);
  const crowd = createCheeringCrowd(scene);
  const structure = new THREE.MeshStandardMaterial({ color: 0x536274, metalness: 0.65, roughness: 0.43 });
  const lamps = new THREE.MeshBasicMaterial({ color: 0xe8f3ff });
  for (let x = -28; x <= 28; x += 7) {
    box(scene, [0.16, 0.22, 46], [x, 10, 0], structure);
    for (const z of [-11, 0, 11]) box(scene, [2.3, 0.035, 0.45], [x, 9.75, z], lamps);
    for (const z of [-23, 23]) box(scene, [0.25, 10, 0.25], [x, 5, z], structure);
  }
  box(scene, [68, 0.15, 50], [0, 11.5, 0], new THREE.MeshStandardMaterial({ color: 0x1e2b3b, roughness: 0.8, side: THREE.DoubleSide }));

  // Contact-generated particles and marks replace the unrelated floating specks.
  const count = 180;
  const positions = new Float32Array(count * 3).fill(-100);
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: 0xeaf9ff, size: 0.025, transparent: true, opacity: 0.56, depthWrite: false }));
  scene.add(particles);
  const velocity = Array.from({ length: count }, () => new THREE.Vector3());
  const life = new Float32Array(count);
  let nextParticle = 0;
  const markCount = 900;
  const marks = new Float32Array(markCount * 6).fill(-100);
  const markGeometry = new THREE.BufferGeometry();
  markGeometry.setAttribute('position', new THREE.BufferAttribute(marks, 3));
  const trail = new THREE.LineSegments(markGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
  scene.add(trail);
  const previousFeet: Array<THREE.Vector3 | null> = [null, null];
  let nextMark = 0, emission = 0;
  const world = new THREE.Vector3();

  return {
    update(dt: number, player: SkaterModel, speed: number, moving: boolean) {
      crowd.update(dt, player.position, moving);
      key.position.copy(player.position).add(new THREE.Vector3(-5, 13, -4));
      key.target.position.copy(player.position);
      player.updateMatrixWorld(true);
      for (let i = 0; i < count; i++) if (life[i] > 0) {
        life[i] -= dt;
        velocity[i].y -= dt * 3.7;
        positions[i * 3] += velocity[i].x * dt;
        positions[i * 3 + 1] += velocity[i].y * dt;
        positions[i * 3 + 2] += velocity[i].z * dt;
        if (life[i] <= 0 || positions[i * 3 + 1] < 0.026) positions[i * 3 + 1] = -100;
      }
      emission += dt;
      const emit = emission > 1 / 42;
      if (emit) emission = 0;
      const pose = player.userData.rig.pose;
      if (pose) pose.feet.forEach((foot, index) => {
        world.copy(foot.position).applyMatrix4(player.matrixWorld);
        if (moving && foot.contact) {
          const last = previousFeet[index];
          if (last && last.distanceTo(world) < 0.8) {
            const m = nextMark++ % markCount;
            marks.set([last.x, 0.032, last.z, world.x, 0.032, world.z], m * 6);
          }
          previousFeet[index] = world.clone();
          if (emit && speed > 8 && foot.pressure > 0.35) {
            const p = nextParticle++ % count;
            positions.set([world.x, 0.045, world.z], p * 3);
            velocity[p].set((index === 0 ? -1 : 1) * (0.24 + foot.pressure * 0.4), 0.3 + Math.random() * 0.45, -0.4)
              .applyQuaternion(player.quaternion);
            life[p] = 0.5;
          }
        } else previousFeet[index] = null;
      });
      particleGeometry.attributes.position.needsUpdate = true;
      markGeometry.attributes.position.needsUpdate = true;
      // Reflection has a stable, finite render target; no full-screen postprocessing chain.
    },
    dispose() { reflection.dispose(); environment.dispose(); scratches.dispose(); },
  };
}
