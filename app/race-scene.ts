import * as THREE from 'three';
import { buildDetailedSkater, animateDetailedSkater, type SkaterModel } from './skater-model';
import { createIceArena } from './ice-arena';
import { trackSample } from './ice-track';
import { RACE_ROSTER } from './characters';
import { sampleGhost, type GhostSample, type RaceState } from './race-engine';

export type Phase = 'ready' | 'countdown' | 'racing' | 'paused' | 'finished';
export type CameraMode = 'chase' | 'tactical';
export type SceneState = { game: RaceState; phase: Phase; camera: CameraMode; highQuality: boolean; ghost: GhostSample[] };

export function createRaceScene(mount: HTMLDivElement, getState: () => SceneState, onFrame: (dt: number) => void, onContextLost: () => void) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, 1, 0.06, 140);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  mount.appendChild(renderer.domElement);
  const arena = createIceArena(scene, renderer);
  const models = new Map<string, SkaterModel>();
  for (const racer of RACE_ROSTER) {
    const model = buildDetailedSkater(racer.primary, racer.accent, racer.id === 'dante', { name: racer.name, number: racer.number });
    scene.add(model); models.set(racer.id, model);
  }
  const ghost = buildDetailedSkater(0x48eaff, 0x177f95);
  const ghostMaterials = new Map<THREE.Material, THREE.Material>();
  ghost.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = object.receiveShadow = false;
      const original = object.material as THREE.Material;
      if (!ghostMaterials.has(original)) {
        const material = original.clone(); material.transparent = true; material.opacity = 0.23; material.depthWrite = false;
        if (material instanceof THREE.MeshStandardMaterial) { material.color.set(0x41e7ff); material.emissive.set(0x1a899c); }
        ghostMaterials.set(original, material);
      }
      object.material = ghostMaterials.get(original)!;
    }
  });
  scene.add(ghost);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.48, 0.51, 64), new THREE.MeshBasicMaterial({ color: 0x4ff1ff, transparent: true, opacity: 0.6, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  const desiredCamera = new THREE.Vector3(), target = new THREE.Vector3(), desiredTarget = new THREE.Vector3();
  let previous = performance.now(), frame = 0, first = true, oldQuality = true;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const resize = () => {
    renderer.setSize(Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight), false);
    camera.aspect = Math.max(1, mount.clientWidth) / Math.max(1, mount.clientHeight); camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(mount); resize();
  const lost = (event: Event) => { event.preventDefault(); onContextLost(); };
  renderer.domElement.addEventListener('webglcontextlost', lost);

  function pose(model: SkaterModel, distance: number, lane: number, dt: number, speed: number, moving: boolean, effort: number) {
    const sample = trackSample(distance, lane);
    model.position.copy(sample.position); model.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);
    animateDetailedSkater(model, dt, speed, sample.corner, moving, effort);
    return sample;
  }

  const animate = (now: number) => {
    const dt = Math.min(0.1, (now - previous) / 1000); previous = now;
    onFrame(dt);
    const state = getState(), game = state.game;
    const moving = state.phase === 'racing';
    const poseDt = state.phase === 'paused' ? 0 : Math.min(dt, 0.04);
    const player = models.get(game.characterId)!;
    const sample = pose(player, game.distance, game.lane, poseDt, game.speed, moving, game.boosting ? 1 : game.rhythm / 100);
    models.forEach((model, id) => { model.visible = id === game.characterId || (state.phase !== 'ready' && game.rivals.some(r => r.id === id)); });
    game.rivals.forEach(r => pose(models.get(r.id)!, r.distance, r.lane, poseDt, r.speed, moving && r.finishTime === null, 0.65));
    const ghostPose = sampleGhost(state.ghost, game.elapsed);
    ghost.visible = game.config.mode === 'time-trial' && state.phase !== 'ready' && ghostPose !== null;
    if (ghostPose) pose(ghost, ghostPose.distance, ghostPose.lane, poseDt, ghostPose.speed, moving, 0.7);
    ring.visible = state.phase !== 'ready'; ring.position.copy(player.position).setY(0.039);
    (ring.material as THREE.MeshBasicMaterial).color.set(game.boosting ? 0xffba59 : 0x4ff1ff);
    if (state.phase === 'ready') {
      desiredCamera.copy(sample.position).addScaledVector(sample.tangent, 3.15).addScaledVector(sample.outward, 1.3).add(new THREE.Vector3(0, 1.4, 0));
      desiredTarget.copy(sample.position).add(new THREE.Vector3(0, 0.96, 0)); camera.filmOffset = 8;
    } else if (state.camera === 'tactical') {
      desiredCamera.copy(sample.position).addScaledVector(sample.tangent, -7).addScaledVector(sample.outward, 4.5).add(new THREE.Vector3(0, 8.2, 0));
      desiredTarget.copy(sample.position).addScaledVector(sample.tangent, 2.5); camera.filmOffset = 0;
    } else {
      desiredCamera.copy(sample.position).addScaledVector(sample.tangent, -4.3).addScaledVector(sample.outward, 0.75).add(new THREE.Vector3(0, 1.95, 0));
      desiredTarget.copy(sample.position).addScaledVector(sample.tangent, 2).add(new THREE.Vector3(0, 0.64, 0)); camera.filmOffset = 0;
    }
    if (first) { camera.position.copy(desiredCamera); target.copy(desiredTarget); first = false; }
    if (state.phase !== 'paused') {
      camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * 6.5)); target.lerp(desiredTarget, 1 - Math.exp(-dt * 9));
    }
    camera.fov = THREE.MathUtils.damp(camera.fov, state.camera === 'tactical' ? 47 : !reducedMotion && moving ? 43 + Math.max(0, game.speed - 9) * 0.55 : 43, 4, dt);
    camera.updateProjectionMatrix(); camera.lookAt(target);
    if (state.highQuality !== oldQuality) {
      oldQuality = state.highQuality; arena.setQuality(oldQuality);
      renderer.setPixelRatio(Math.min(oldQuality ? 1.5 : 1, window.devicePixelRatio)); resize();
    }
    arena.update(poseDt, player, game.speed, moving);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);
  return () => {
    cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener('webglcontextlost', lost);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    scene.traverse(object => {
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      }
    });
    ghostMaterials.forEach((_, original) => materials.add(original));
    for (const material of materials) { Object.values(material).forEach(v => { if (v instanceof THREE.Texture) textures.add(v); }); material.dispose(); }
    geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose()); arena.dispose(); renderer.dispose(); renderer.domElement.remove();
  };
}
