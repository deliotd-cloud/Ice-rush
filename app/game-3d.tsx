'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { buildDetailedSkater, animateDetailedSkater, type SkaterModel } from './skater-model';
import { createIceArena } from './ice-arena';
import { LAP_LENGTH, trackSample } from './ice-track';
import { CHARACTERS, RACE_ROSTER, createOpponents, getCharacter, isCharacterId, type CharacterId } from './characters';
import { Play, RotateCcw, Trophy, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

type Phase = 'ready' | 'countdown' | 'racing' | 'finished';

type Racer = {
  id: string;
  name: string;
  primary: number;
  accent: number;
  lane: number;
  distance: number;
  baseSpeed: number;
};

type GameState = {
  characterId: CharacterId;
  playerDistance: number;
  speed: number;
  lane: number;
  targetLane: number;
  laneVelocity: number;
  stamina: number;
  rhythm: number;
  elapsed: number;
  lastStrideAt: number;
  lastStrideKey: string;
  racers: Racer[];
};

type HudState = {
  speed: number;
  lap: number;
  position: number;
  stamina: number;
  rhythm: number;
  time: number;
  progress: number;
};

type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};

type ModelContext = {
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

const LAPS = 3;
const TOTAL_DISTANCE = LAP_LENGTH * LAPS;

const initialHud: HudState = {
  speed: 0,
  lap: 1,
  position: 1,
  stamina: 100,
  rhythm: 50,
  time: 0,
  progress: 0,
};

function createGame(characterId: CharacterId = 'dante'): GameState {
  return {
    characterId,
    playerDistance: 0,
    speed: 8.4,
    lane: 1,
    targetLane: 1,
    laneVelocity: 0,
    stamina: 100,
    rhythm: 50,
    elapsed: 0,
    lastStrideAt: 0,
    lastStrideKey: '',
    racers: createOpponents(characterId),
  };
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${rest}`;
}

function ordinal(place: number) {
  return ['1ST', '2ND', '3RD', '4TH'][place - 1] ?? `${place}TH`;
}

function positionSkater(
  skater: SkaterModel, distance: number, lane: number, dt: number,
  speed: number, moving: boolean, effort: number,
) {
  const sample = trackSample(distance, lane);
  skater.position.copy(sample.position);
  skater.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);
  animateDetailedSkater(skater, dt, speed, sample.corner, moving, effort);
  return sample;
}

export default function Game3D() {
  const stageRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameState>(createGame());
  const phaseRef = useRef<Phase>('ready');
  const selectedCharacterRef = useRef<CharacterId>('dante');
  const keysRef = useRef(new Set<string>());
  const finishHandledRef = useRef(false);
  const hudTickRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [selectedCharacterId, setSelectedCharacterId] = useState<CharacterId>('dante');
  const selectedCharacter = getCharacter(selectedCharacterId);
  const [countdown, setCountdown] = useState(3);
  const [hud, setHud] = useState<HudState>(initialHud);
  const [finalPlace, setFinalPlace] = useState(1);
  const [bestTime, setBestTime] = useState<number | null>(null);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const chooseCharacter = useCallback((id: unknown) => {
    if (!isCharacterId(id) || phaseRef.current !== 'ready') return;
    selectedCharacterRef.current = id;
    setSelectedCharacterId(id);
    gameRef.current = createGame(id);
    setHud(initialHud);
  }, []);

  const returnToSelection = useCallback(() => {
    gameRef.current = createGame(selectedCharacterRef.current);
    keysRef.current.clear();
    setHud(initialHud);
    changePhase('ready');
  }, [changePhase]);

  const startRace = useCallback(() => {
    gameRef.current = createGame(selectedCharacterRef.current);
    keysRef.current.clear();
    finishHandledRef.current = false;
    setHud({ ...initialHud, speed: 8.4 });
    setCountdown(3);
    changePhase('countdown');
  }, [changePhase]);

  useEffect(() => {
    const stored = window.localStorage.getItem('dante-ice-rush-best');
    if (stored) setBestTime(Number(stored));
  }, []);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown > 0) {
      const timer = window.setTimeout(() => setCountdown((value) => value - 1), 720);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => changePhase('racing'), 560);
    return () => window.clearTimeout(timer);
  }, [changePhase, countdown, phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (phaseRef.current === 'racing' && ['ArrowUp', 'ArrowDown', 'Space', 'KeyA', 'KeyD'].includes(event.code)) event.preventDefault();
      if (event.repeat) return;
      keysRef.current.add(event.code);
      if (phaseRef.current === 'ready' && ['Digit1', 'Digit2', 'Digit3'].includes(event.code)) {
        chooseCharacter(CHARACTERS[Number(event.code.slice(-1)) - 1].id);
        return;
      }

      const focusedControl = (event.target as HTMLElement | null)?.closest('button, input, textarea, select, [role="radio"]');
      if ((phaseRef.current === 'ready' || phaseRef.current === 'finished') && event.code === 'Enter' && !focusedControl) {
        startRace();
        return;
      }
      if (phaseRef.current !== 'racing') return;
      const game = gameRef.current;
      if (event.code === 'ArrowUp') game.targetLane = Math.max(0, game.targetLane - 1);
      if (event.code === 'ArrowDown') game.targetLane = Math.min(2, game.targetLane + 1);

      if (event.code === 'KeyA' || event.code === 'KeyD') {
        const now = performance.now();
        const gap = now - game.lastStrideAt;
        const alternating = event.code !== game.lastStrideKey;
        const timedWell = gap >= 125 && gap <= 470;
        if (alternating && timedWell) {
          const precision = 1 - Math.min(1, Math.abs(gap - 260) / 210);
          game.speed = Math.min(16.4, game.speed + 0.62 + precision * 0.52);
          game.rhythm = Math.min(100, game.rhythm + 8 + precision * 7);
        } else if (alternating) {
          game.speed = Math.min(15.2, game.speed + 0.34);
          game.rhythm = Math.max(0, game.rhythm - 3);
        } else {
          game.speed = Math.max(5, game.speed - 0.55);
          game.rhythm = Math.max(0, game.rhythm - 12);
        }
        game.lastStrideAt = now;
        game.lastStrideKey = event.code;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => keysRef.current.delete(event.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [startRace, chooseCharacter]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const requireEmptyObject = (input: unknown) => {
      if (
        typeof input !== 'object' || input === null || Array.isArray(input) ||
        Object.keys(input as Record<string, unknown>).length > 0
      ) throw new Error('This action accepts an empty object only.');
    };
    const tools: WebMcpTool[] = [
      {
        name: 'select_speed_skater',
        title: 'Select a playable skater',
        description: 'Choose Dante, Nova or Kai on the character-selection screen. Available before the race starts.',
        inputSchema: { type: 'object', properties: { characterId: { type: 'string', enum: ['dante', 'nova', 'kai'] } }, required: ['characterId'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length !== 1 || !('characterId' in input) || !isCharacterId(input.characterId)) {
            throw new Error('Choose a characterId of dante, nova or kai.');
          }
          if (phaseRef.current !== 'ready') throw new Error('Return to character selection before choosing another skater.');
          chooseCharacter(input.characterId);
          await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
          return { phase: 'ready', characterId: input.characterId, skater: getCharacter(input.characterId).name };
        },
      },
      {
        name: 'start_speed_skating_race',
        title: 'Start 3D speed skating race',
        description: 'Start a fresh three-lap 3D race with the selected skater and show the visible countdown.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          requireEmptyObject(input);
          startRace();
          await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
          return { status: 'countdown', skater: getCharacter(selectedCharacterRef.current).name, laps: LAPS, camera: '3D chase' };
        },
      },
      {
        name: 'read_speed_skating_race',
        title: 'Read 3D race status',
        description: 'Read the selected skater’s identity, race phase, lap, position, speed, and elapsed time.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input) {
          requireEmptyObject(input);
          const game = gameRef.current;
          return {
            characterId: game.characterId,
            skater: getCharacter(game.characterId).name,
            phase: phaseRef.current,
            lap: Math.min(LAPS, Math.floor(game.playerDistance / LAP_LENGTH) + 1),
            position: 1 + game.racers.filter((racer) => racer.distance > game.playerDistance).length,
            speedMps: Number(game.speed.toFixed(1)),
            elapsedSeconds: Number(game.elapsed.toFixed(2)),
          };
        },
      },
    ];
    try {
      tools.forEach((tool) => {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
      });
    } catch {
      lifecycle.abort();
      return;
    }
    return () => lifecycle.abort();
  }, [startRace, chooseCharacter]);

  useEffect(() => {
    const mount = stageRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(43, 1, 0.06, 120);
    camera.position.set(0, 4, -15);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    mount.appendChild(renderer.domElement);

    const arena = createIceArena(scene, renderer);

    const models = new Map<string, SkaterModel>();
    RACE_ROSTER.forEach((racer) => {
      const model = buildDetailedSkater(racer.primary, racer.accent, racer.id === 'dante', { name: racer.name, number: racer.number });
      scene.add(model);
      models.set(racer.id, model);
    });

    const cameraTarget = new THREE.Vector3();
    const desiredCamera = new THREE.Vector3();
    let previous = performance.now();
    let animationFrame = 0;

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const animate = (now: number) => {
      const dt = Math.min(0.034, (now - previous) / 1000);
      previous = now;
      const game = gameRef.current;
      const player = models.get(game.characterId)!;

      if (phaseRef.current === 'racing') {
        game.elapsed += dt;
        game.laneVelocity += ((game.targetLane - game.lane) * 9 - game.laneVelocity * 6) * dt;
        game.lane += game.laneVelocity * dt;
        const idleFor = now - game.lastStrideAt;
        game.speed = Math.max(5.2, game.speed - (idleFor > 650 ? 2.15 : 0.55) * dt);
        game.rhythm = Math.max(0, game.rhythm - (idleFor > 650 ? 12 : 3.5) * dt);
        if (keysRef.current.has('Space') && game.stamina > 0) {
          game.speed = Math.min(17.1, game.speed + 2.15 * dt);
          game.stamina = Math.max(0, game.stamina - 24 * dt);
        } else {
          game.stamina = Math.min(100, game.stamina + 8.5 * dt);
        }
        const lanePenalty = Math.abs(game.lane - 0.25) * 0.043;
        game.playerDistance += game.speed * (1 - lanePenalty) * dt;
        game.racers.forEach((racer, index) => {
          racer.distance += (racer.baseSpeed + Math.sin(game.elapsed * (0.65 + index * 0.09) + index * 1.8) * 0.22) * dt;
        });

        if (game.playerDistance >= TOTAL_DISTANCE && !finishHandledRef.current) {
          finishHandledRef.current = true;
          const place = 1 + game.racers.filter((racer) => racer.distance > game.playerDistance).length;
          setFinalPlace(place);
          const saved = window.localStorage.getItem('dante-ice-rush-best');
          if (!saved || game.elapsed < Number(saved)) {
            window.localStorage.setItem('dante-ice-rush-best', String(game.elapsed));
            setBestTime(game.elapsed);
          }
          changePhase('finished');
        }

        hudTickRef.current += dt;
        if (hudTickRef.current > 0.05) {
          hudTickRef.current = 0;
          setHud({
            speed: game.speed,
            lap: Math.min(LAPS, Math.floor(game.playerDistance / LAP_LENGTH) + 1),
            position: 1 + game.racers.filter((racer) => racer.distance > game.playerDistance).length,
            stamina: game.stamina,
            rhythm: game.rhythm,
            time: game.elapsed,
            progress: Math.min(100, (game.playerDistance / TOTAL_DISTANCE) * 100),
          });
        }
      }

      const moving = phaseRef.current === 'racing';
      const effort = moving ? Math.min(1, game.rhythm / 100 + (keysRef.current.has('Space') ? 0.3 : 0)) : 0;
      const playerMotion = positionSkater(player, game.playerDistance, game.lane, dt, game.speed, moving, effort);
      models.forEach((model, id) => { model.visible = phaseRef.current !== 'ready' || id === game.characterId; });
      game.racers.forEach((racer) => {
        positionSkater(models.get(racer.id)!, racer.distance, racer.lane, dt, racer.baseSpeed, moving, 0.55);
      });
      const outward = playerMotion.outward;
      if (phaseRef.current === 'ready') {
        desiredCamera.copy(playerMotion.position)
          .addScaledVector(playerMotion.tangent, 3.15)
          .addScaledVector(outward, 1.3)
          .add(new THREE.Vector3(0, 1.4, 0));
        cameraTarget.copy(playerMotion.position).add(new THREE.Vector3(0, 0.96, 0));
        camera.filmOffset = 8;
      } else {
        camera.filmOffset = 0;
        desiredCamera.copy(playerMotion.position)
          .addScaledVector(playerMotion.tangent, -3.65)
          .addScaledVector(outward, 1.02)
          .add(new THREE.Vector3(0, 1.65, 0));
        cameraTarget.copy(playerMotion.position)
          .addScaledVector(playerMotion.tangent, 1.35)
          .add(new THREE.Vector3(0, 0.64, 0));
      }
      camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * (moving ? 7.5 : 4)));
      camera.fov = THREE.MathUtils.damp(camera.fov, moving ? 43 + Math.max(0, game.speed - 9) * 0.45 : 39, 3, dt);
      camera.updateProjectionMatrix();
      camera.lookAt(cameraTarget);
      arena.update(dt, player, game.speed, moving);
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      const releasedTextures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if (material) Object.values(material).forEach((value) => {
              if (value instanceof THREE.Texture && !releasedTextures.has(value)) {
                value.dispose();
                releasedTextures.add(value);
              }
            });
            material?.dispose();
          });
        }
      });
      arena.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [changePhase]);

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="brand-lockup">
          <span className="brand-mark">DR</span>
          <div>
            <p className="eyebrow">NIGHT CIRCUIT 01</p>
            <h1>DANTE <span>// ICE RUSH</span></h1>
          </div>
        </div>
        <div className="race-meta">
          <span>333M</span>
          <span>3 LAPS</span>
          <span className="live-3d">REAL-TIME 3D</span>
        </div>
      </header>

      <section className={`arena-frame ${phase === 'ready' ? 'is-selecting' : ''}`} aria-label="Real-time 3D speed skating arena">
        <div ref={stageRef} className="race-stage" role="img" aria-label={`${selectedCharacter.name} and three opponents in the 3D ice arena`} />

        <div className="hud hud-left" aria-live="polite">
          <p className="hud-label">{selectedCharacter.name.toUpperCase()} · VELOCITY</p>
          <div className="speed-readout"><strong>{hud.speed.toFixed(1)}</strong><span>M/S</span></div>
          <div className="mini-readout"><span>LAP {hud.lap}/{LAPS}</span><span>{formatTime(hud.time)}</span></div>
        </div>
        <div className="hud hud-position"><p className="hud-label">LIVE POSITION</p><strong>{ordinal(hud.position)}</strong></div>
        <div className="hud hud-right">
          <div className="meter-row"><span><Zap size={13} /> BOOST</span><span>{Math.round(hud.stamina)}%</span></div>
          <div className="meter"><i style={{ width: `${hud.stamina}%` }} /></div>
          <div className="meter-row rhythm-row"><span>STRIDE RHYTHM</span><span>{Math.round(hud.rhythm)}%</span></div>
          <div className="meter rhythm"><i style={{ width: `${hud.rhythm}%` }} /></div>
        </div>
        <div className="camera-badge"><span /> CHASE CAM</div>
        <div className="race-progress" aria-hidden="true"><i style={{ width: `${hud.progress}%` }} /></div>

        {phase === 'ready' && (
          <div className="start-screen">
            <div className="character-spotlight">
              <figure className="character-photo">
                <img key={selectedCharacter.id} src={selectedCharacter.photo} alt={`${selectedCharacter.name} character artwork, leaning into a corner in ${selectedCharacter.colors.toLowerCase()} race colours with bare steel skate blades`} width={1024} height={1536} fetchPriority="high" />
                <figcaption><span>{selectedCharacter.name.toUpperCase()} · {selectedCharacter.number}</span> Character artwork</figcaption>
              </figure>
            </div>
            <div className="start-copy">
              <p className="eyebrow red" id="character-selection-label">CHOOSE YOUR SKATER</p>
              <h2>{selectedCharacter.name.toUpperCase()}</h2>
              <p className="role">#{selectedCharacter.number} · {selectedCharacter.colors}</p>
              <p className="intro">{selectedCharacter.description}</p>
              <RadioGroup value={selectedCharacterId} onValueChange={chooseCharacter} aria-labelledby="character-selection-label" className="character-options">
                {CHARACTERS.map((character, index) => (
                  <label key={character.id} htmlFor={`character-${character.id}`} className={`character-option ${character.id === selectedCharacterId ? 'is-selected' : ''}`}>
                    <RadioGroupItem id={`character-${character.id}`} value={character.id} className="character-radio" />
                    <span className={`character-option-image option-${character.id}`}>
                      <img src={character.photo} alt="" width={1024} height={1536} />
                      <kbd>{index + 1}</kbd>
                    </span>
                    <span className="character-option-name">{character.name}</span>
                    <span className="character-option-description">{character.colors}</span>
                  </label>
                ))}
              </RadioGroup>
              <Button onClick={startRace} size="lg" className="start-button"><Play fill="currentColor" /> RACE AS {selectedCharacter.name.toUpperCase()} <kbd>ENTER</kbd></Button>
              {bestTime !== null && <p className="best-time">PERSONAL BEST {formatTime(bestTime)}</p>}
            </div>
          </div>
        )}

        {phase === 'countdown' && (
          <div className="countdown" aria-live="assertive"><span>{countdown === 0 ? 'GO!' : countdown}</span><p>{countdown === 0 ? 'FIND YOUR RHYTHM' : 'SET YOUR EDGE'}</p></div>
        )}

        {phase === 'finished' && (
          <div className="finish-screen">
            <div className="finish-card">
              <Trophy /><p className="eyebrow red">RACE COMPLETE</p><h2>{ordinal(finalPlace)}</h2>
              <p className="finish-time">{formatTime(hud.time)}</p>
              <p>{finalPlace === 1 ? `${selectedCharacter.name} wins the night circuit.` : `${selectedCharacter.name} finishes ${ordinal(finalPlace).toLowerCase()}.`}</p>
              <Button onClick={startRace} size="lg" className="start-button"><RotateCcw /> RACE AGAIN <kbd>ENTER</kbd></Button>
              <Button onClick={returnToSelection} variant="ghost" className="choose-again-button">CHOOSE CHARACTER</Button>
            </div>
          </div>
        )}
      </section>

      <footer className="control-deck">
        <div className="control-group"><span className="control-label">STRIDE</span><kbd>A</kbd><span className="alternate">↔</span><kbd>D</kbd><p>Alternate in rhythm to build speed</p></div>
        <div className="control-group"><span className="control-label">CHANGE LANE</span><kbd>↑</kbd><kbd>↓</kbd><p>Take the inside or pass outside</p></div>
        <div className="control-group"><span className="control-label">BOOST</span><kbd className="wide">SPACE</kbd><p>Burn energy for a final surge</p></div>
        <div className="race-tip"><span>COACH&apos;S NOTE</span>A clean alternating stride beats frantic tapping.</div>
      </footer>
    </main>
  );
}
