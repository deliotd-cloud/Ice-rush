'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, Trophy, Zap, Pause, Volume2, VolumeX, Camera, Flag, ArrowUp, ArrowDown, Gauge, Home, Gamepad2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CHARACTERS, getCharacter, isCharacterId, type CharacterId } from './characters';
import { LAP_LENGTH, trackSample } from './ice-track';
import { createRaceScene, type CameraMode, type Phase } from './race-scene';
import { RaceAudio } from './race-audio';
import { createRace, stepRace, stride, changeLane, sampleGhost, parseRecords, recordKey, DEFAULT_CONFIG, DIFFICULTIES, RACE_DISTANCE, LAPS, STEP, STRIDE_INTERVAL, type RaceState, type RaceConfig, type SavedRecord, type GhostSample, type RaceMode, type Difficulty } from './race-engine';

type WebMcpTool = { name: string; description: string; inputSchema: Record<string, unknown>; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown };
type ModelContext = { registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => void | Promise<void> };
const RECORDS_KEY = 'ice-rush-records-v2';
const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const ordinal = (p: number) => ['1ST', '2ND', '3RD', '4TH'][p - 1];
const snapshot = (g: RaceState): RaceState => ({ ...g, rivals: g.rivals.map(r => ({ ...r })), lapTimes: [...g.lapTimes], recording: [] });

function MiniMap({ game, ghost }: { game: RaceState; ghost: GhostSample | null }) {
  const point = (distance: number, lane: number) => { const p = trackSample(distance, lane).position; return { x: 75 + p.x * 2.4, y: 33 + p.z * 2.4 }; };
  const p = point(game.distance, game.lane);
  return <svg viewBox="0 0 150 66" className="track-map" role="img" aria-label="Live track map: your skater is cyan"><rect x="17" y="10" width="116" height="46" rx="23" fill="none" stroke="#38566a" strokeWidth="8" /><path d="M75 6v14" stroke="#e5f8ff" strokeWidth="2" />{game.rivals.map(r => { const q = point(r.distance, r.lane); return <circle key={r.id} cx={q.x} cy={q.y} r="3.4" fill={`#${r.accent.toString(16).padStart(6, '0')}`} />; })}{ghost && (() => { const q = point(ghost.distance, ghost.lane); return <circle cx={q.x} cy={q.y} r="3.5" fill="none" stroke="#83ebff" />; })()}<circle cx={p.x} cy={p.y} r="4.4" fill="#55efff" stroke="#fff" strokeWidth="1.3" /></svg>;
}

export default function Game3D() {
  const stageRef = useRef<HTMLDivElement>(null), gameRef = useRef(createRace()), phaseRef = useRef<Phase>('ready');
  const configRef = useRef<RaceConfig>({ ...DEFAULT_CONFIG }), characterRef = useRef<CharacterId>('dante');
  const keys = useRef(new Set<string>()), virtualInput = useRef({ skate: false, boost: false });
  const recordsRef = useRef<Record<string, SavedRecord>>({}), ghostRef = useRef<GhostSample[]>([]);
  const cameraRef = useRef<CameraMode>('chase'), qualityRef = useRef(true), audio = useRef(new RaceAudio());
  const pausedFrom = useRef<'countdown' | 'racing'>('racing'), countdownClock = useRef(3), lastCount = useRef(3);
  const accumulator = useRef(0), hudClock = useRef(0), padPrevious = useRef<boolean[]>([]), laneRepeat = useRef(0), finishHandled = useRef(false);
  const frameRef = useRef<(dt: number) => void>(() => undefined);
  const [phase, setPhase] = useState<Phase>('ready'), [selectedId, setSelectedId] = useState<CharacterId>('dante');
  const [config, setConfig] = useState<RaceConfig>({ ...DEFAULT_CONFIG }), [hud, setHud] = useState(() => snapshot(gameRef.current));
  const [countdown, setCountdown] = useState(3), [camera, setCamera] = useState<CameraMode>('chase');
  const [muted, setMuted] = useState(false), [quality, setQuality] = useState(true), [records, setRecords] = useState<Record<string, SavedRecord>>({});
  const [newBest, setNewBest] = useState(false), [storageWarning, setStorageWarning] = useState(false), [graphicsError, setGraphicsError] = useState(false), [controller, setController] = useState(false);
  const selected = getCharacter(selectedId), best = records[recordKey(config)], active = phase === 'racing' || phase === 'countdown';
  const changePhase = useCallback((next: Phase) => { phaseRef.current = next; setPhase(next); }, []);
  const clearInput = useCallback(() => { keys.current.clear(); virtualInput.current = { skate: false, boost: false }; }, []);
  const chooseCharacter = useCallback((id: unknown) => { if (!isCharacterId(id) || phaseRef.current !== 'ready') return; characterRef.current = id; setSelectedId(id); gameRef.current = createRace(id, configRef.current); setHud(snapshot(gameRef.current)); }, []);
  const configure = useCallback((next: RaceConfig) => { if (phaseRef.current !== 'ready') return; configRef.current = { ...next }; setConfig({ ...next }); gameRef.current = createRace(characterRef.current, next); setHud(snapshot(gameRef.current)); }, []);
  const startRace = useCallback(() => {
    if (phaseRef.current === 'racing' || phaseRef.current === 'countdown') return;
    audio.current.unlock(); gameRef.current = createRace(characterRef.current, configRef.current);
    ghostRef.current = configRef.current.mode === 'time-trial' ? recordsRef.current['time-trial']?.samples ?? [] : [];
    clearInput(); accumulator.current = 0; hudClock.current = 0; finishHandled.current = false;
    countdownClock.current = 3; lastCount.current = 3; setCountdown(3); setNewBest(false);
    setHud(snapshot(gameRef.current)); changePhase('countdown'); audio.current.tone(520, 0.11);
  }, [changePhase, clearInput]);
  const pauseRace = useCallback(() => { if (phaseRef.current !== 'racing' && phaseRef.current !== 'countdown') return; pausedFrom.current = phaseRef.current; clearInput(); changePhase('paused'); audio.current.update(0, false, false); }, [changePhase, clearInput]);
  const resumeRace = useCallback(() => { if (phaseRef.current !== 'paused' || graphicsError) return; clearInput(); accumulator.current = 0; audio.current.unlock(); changePhase(pausedFrom.current); }, [changePhase, clearInput, graphicsError]);
  const returnToSelection = useCallback(() => { clearInput(); gameRef.current = createRace(characterRef.current, configRef.current); setHud(snapshot(gameRef.current)); changePhase('ready'); audio.current.update(0, false, false); }, [changePhase, clearInput]);
  const cycleCamera = useCallback(() => { const next = cameraRef.current === 'chase' ? 'tactical' : 'chase'; cameraRef.current = next; setCamera(next); }, []);
  const toggleMute = useCallback(() => { audio.current.unlock(); const next = !audio.current.muted; audio.current.setMuted(next); setMuted(next); try { localStorage.setItem('ice-rush-muted', String(next)); } catch {} }, []);
  const toggleQuality = useCallback(() => { qualityRef.current = !qualityRef.current; setQuality(qualityRef.current); }, []);
  const manualStride = useCallback((side: 'A' | 'D') => { if (phaseRef.current !== 'racing') return; const result = stride(gameRef.current, side); if (result !== 'ignored') audio.current.stride(result === 'perfect'); }, []);
  useEffect(() => {
    try { const loaded = parseRecords(localStorage.getItem(RECORDS_KEY)); recordsRef.current = loaded; setRecords(loaded); const mute = localStorage.getItem('ice-rush-muted') === 'true'; audio.current.setMuted(mute); setMuted(mute); } catch { setStorageWarning(true); }
    return () => audio.current.dispose();
  }, []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (['racing', 'countdown'].includes(phaseRef.current) && ['KeyW', 'KeyA', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (event.repeat) return; keys.current.add(event.code);
      if (event.code === 'Escape' || event.code === 'KeyP') { event.preventDefault(); if (phaseRef.current === 'paused') resumeRace(); else pauseRace(); return; }
      if (event.code === 'KeyM') { toggleMute(); return; } if (event.code === 'KeyC') { cycleCamera(); return; }
      if (phaseRef.current === 'ready' && /^Digit[123]$/.test(event.code)) { chooseCharacter(CHARACTERS[Number(event.code.slice(-1)) - 1].id); return; }
      const focused = (event.target as HTMLElement | null)?.closest('button, input, textarea, select, [role="radio"]');
      if (event.code === 'Enter' && !focused) { if (phaseRef.current === 'paused') resumeRace(); else startRace(); return; }
      if (phaseRef.current !== 'racing') return;
      if (event.code === 'ArrowUp' || event.code === 'ArrowLeft') changeLane(gameRef.current, -1);
      if (event.code === 'ArrowDown' || event.code === 'ArrowRight') changeLane(gameRef.current, 1);
      if (event.code === 'KeyA') manualStride('A'); if (event.code === 'KeyD') manualStride('D');
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code), hidden = () => { if (document.hidden) pauseRace(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', pauseRace); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', pauseRace); document.removeEventListener('visibilitychange', hidden); };
  }, [chooseCharacter, cycleCamera, manualStride, pauseRace, resumeRace, startRace, toggleMute]);

  frameRef.current = dt => {
    let pad: Gamepad | null = null;
    try { pad = Array.from(navigator.getGamepads?.() ?? []).find(g => g?.connected && g.mapping === 'standard') ?? null; } catch {}
    const buttons = pad?.buttons.map(b => b.pressed) ?? [], edge = (i: number) => buttons[i] && !padPrevious.current[i];
    const wasReady = phaseRef.current === 'ready' || phaseRef.current === 'finished';
    if (edge(9)) { if (phaseRef.current === 'paused') resumeRace(); else if (wasReady) startRace(); else pauseRace(); }
    if (edge(3)) cycleCamera(); if (wasReady && edge(0)) startRace();
    if (phaseRef.current === 'ready' && (edge(14) || edge(15))) { const i = CHARACTERS.findIndex(c => c.id === characterRef.current); chooseCharacter(CHARACTERS[(i + (edge(14) ? 2 : 1)) % 3].id); }
    if (phaseRef.current === 'racing') {
      if (edge(4)) manualStride('A'); if (edge(5)) manualStride('D'); laneRepeat.current -= dt;
      const axis = pad?.axes[0] ?? 0;
      if (laneRepeat.current <= 0 && (Math.abs(axis) > 0.55 || buttons[14] || buttons[15])) { changeLane(gameRef.current, axis < -0.55 || buttons[14] ? -1 : 1); laneRepeat.current = 0.3; }
    }
    padPrevious.current = buttons;
    if (phaseRef.current === 'countdown') {
      countdownClock.current -= dt; const count = Math.max(0, Math.ceil(countdownClock.current));
      if (count !== lastCount.current) { lastCount.current = count; setCountdown(count); audio.current.tone(count ? 520 : 1040, count ? 0.11 : 0.35); }
      if (countdownClock.current <= 0) { changePhase('racing'); gameRef.current.feedback = 'GO! · HOLD W OR TAP A / D'; gameRef.current.feedbackUntil = 2; }
    }
    if (phaseRef.current === 'racing') {
      accumulator.current += dt;
      const input = { skate: keys.current.has('KeyW') || virtualInput.current.skate || !!buttons[0], boost: keys.current.has('Space') || virtualInput.current.boost || !!buttons[7] };
      while (accumulator.current >= STEP && !finishHandled.current) {
        const last = gameRef.current.lastStrideAt, events = stepRace(gameRef.current, input); accumulator.current -= STEP;
        if (gameRef.current.lastStrideAt !== last) audio.current.stride(false);
        for (const event of events) {
          if (event === 'lap') { audio.current.tone(660); audio.current.tone(990, 0.2, 0.12); }
          if (event === 'pass') audio.current.tone(880, 0.08, 0, 0.12);
          if (event === 'finish') {
            finishHandled.current = true; const g = gameRef.current, key = recordKey(g.config), old = recordsRef.current[key];
            if (!old || g.finishTime! < old.time) { const updated = { ...recordsRef.current, [key]: { time: g.finishTime!, samples: g.recording } }; recordsRef.current = updated; setRecords(updated); setNewBest(true); try { localStorage.setItem(RECORDS_KEY, JSON.stringify(updated)); } catch { setStorageWarning(true); } }
            setHud(snapshot(g)); clearInput(); changePhase('finished'); audio.current.finish(g.position === 1);
          }
        }
      }
    }
    audio.current.update(gameRef.current.speed, phaseRef.current === 'racing', gameRef.current.boosting);
    hudClock.current += dt;
    if (hudClock.current > 0.075) { hudClock.current = 0; if (phaseRef.current === 'racing') setHud(snapshot(gameRef.current)); setController(!!pad); }
  };
  useEffect(() => {
    if (!stageRef.current) return;
    try { return createRaceScene(stageRef.current, () => ({ game: gameRef.current, phase: phaseRef.current, camera: cameraRef.current, highQuality: qualityRef.current, ghost: ghostRef.current }), dt => frameRef.current(dt), () => { pauseRace(); setGraphicsError(true); }); } catch { setGraphicsError(true); }
  }, [pauseRace]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return; const lifecycle = new AbortController();
    const object = (input: unknown, allowed: string[]) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) throw new Error('Unexpected action input.'); return input as Record<string, unknown>; };
    const ready = () => { if (phaseRef.current !== 'ready') throw new Error('Return to the character-selection screen first.'); };
    const settled = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const read = () => { const g = gameRef.current; return { characterId: g.characterId, skater: getCharacter(g.characterId).name, phase: phaseRef.current, mode: g.config.mode, difficulty: g.config.difficulty, elapsedSeconds: +g.elapsed.toFixed(2), speedMps: +g.speed.toFixed(2), distance: +g.distance.toFixed(2), lane: +g.lane.toFixed(2), targetLane: g.targetLane, lap: Math.min(LAPS, Math.floor(g.distance / LAP_LENGTH) + 1), position: g.position, stamina: +g.stamina.toFixed(1), drafting: g.drafting, combo: g.combo, finishTime: g.finishTime, lapTimes: g.lapTimes, ghostAvailable: !!recordsRef.current['time-trial']?.samples.length, camera: cameraRef.current, graphicsAvailable: !graphicsError }; };
    const make = (name: string, description: string, properties: Record<string, unknown>, required: string[], execute: WebMcpTool['execute'], readOnly = false): WebMcpTool => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: readOnly }, execute });
    const tools = [
      make('read_speed_skating_race', 'Read skater, settings and live race status.', {}, [], input => { object(input, []); return read(); }, true),
      make('select_speed_skater', 'Choose Dante, Nova or Kai before racing.', { characterId: { type: 'string', enum: ['dante', 'nova', 'kai'] } }, ['characterId'], async input => { const p = object(input, ['characterId']); ready(); if (!isCharacterId(p.characterId)) throw new Error('Unknown skater.'); chooseCharacter(p.characterId); await settled(); return read(); }),
      make('configure_speed_skating_race', 'Choose race or time-trial mode and difficulty before racing.', { mode: { type: 'string', enum: ['race', 'time-trial'] }, difficulty: { type: 'string', enum: ['rookie', 'club', 'elite'] } }, ['mode', 'difficulty'], async input => { const p = object(input, ['mode', 'difficulty']); ready(); if (!['race', 'time-trial'].includes(String(p.mode)) || !DIFFICULTIES.some(d => d.id === p.difficulty)) throw new Error('Invalid mode or difficulty.'); configure({ mode: p.mode as RaceMode, difficulty: p.difficulty as Difficulty }); await settled(); return read(); }),
      make('start_speed_skating_race', 'Start a three-lap race from the menu, results or pause screen.', {}, [], async input => { object(input, []); if (['racing', 'countdown'].includes(phaseRef.current)) throw new Error('A race is already active.'); if (graphicsError) throw new Error('3D graphics unavailable.'); startRace(); await settled(); return read(); }),
      make('drive_speed_skater', 'Hold or release assisted skating and boost, like holding W and Space.', { skate: { type: 'boolean' }, boost: { type: 'boolean' } }, ['skate', 'boost'], async input => { const p = object(input, ['skate', 'boost']); if (typeof p.skate !== 'boolean' || typeof p.boost !== 'boolean') throw new Error('Skate and boost must be booleans.'); if (!['racing', 'countdown'].includes(phaseRef.current)) throw new Error('Start or resume a race first.'); virtualInput.current = { skate: p.skate, boost: p.boost }; await settled(); return read(); }),
      make('steer_speed_skater', 'Move one racing line inside or outside during a race.', { direction: { type: 'string', enum: ['inside', 'outside'] } }, ['direction'], async input => { const p = object(input, ['direction']); if (!['inside', 'outside'].includes(String(p.direction))) throw new Error('Choose inside or outside.'); if (phaseRef.current !== 'racing') throw new Error('Steering is available while racing.'); changeLane(gameRef.current, p.direction === 'inside' ? -1 : 1); await settled(); return read(); }),
      make('control_speed_skating_race', 'Pause, resume, or abandon the race and return to the character menu.', { action: { type: 'string', enum: ['pause', 'resume', 'menu'] } }, ['action'], async input => { const p = object(input, ['action']); if (p.action === 'pause' && ['racing', 'countdown'].includes(phaseRef.current)) pauseRace(); else if (p.action === 'resume' && phaseRef.current === 'paused') resumeRace(); else if (p.action === 'menu') returnToSelection(); else throw new Error('Action unavailable in this race state.'); await settled(); return read(); }),
    ];
    try { tools.forEach(tool => { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); }); } catch { lifecycle.abort(); }
    return () => lifecycle.abort();
  }, [chooseCharacter, configure, pauseRace, resumeRace, returnToSelection, startRace, graphicsError]);

  const hold = (code: string) => ({ onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); keys.current.add(code); audio.current.unlock(); }, onPointerUp: () => keys.current.delete(code), onPointerCancel: () => keys.current.delete(code), onLostPointerCapture: () => keys.current.delete(code), onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); keys.current.add(code); } }, onKeyUp: () => keys.current.delete(code), onBlur: () => keys.current.delete(code) });
  const ghost = config.mode === 'time-trial' ? sampleGhost(ghostRef.current, hud.elapsed) : null, ghostGap = ghost ? hud.distance - ghost.distance : null;
  const lap = Math.min(LAPS, Math.floor(hud.distance / LAP_LENGTH) + 1), timing = Math.min(1.4, Math.max(0, (hud.elapsed - hud.lastStrideAt) / STRIDE_INTERVAL)) / 1.4, nextFoot = hud.lastStrideKey === 'A' ? 'D' : 'A';
  const leaderboard = [{ id: selectedId, name: selected.name, distance: hud.distance, player: true, accent: selected.primary }, ...hud.rivals.map(r => ({ ...r, player: false }))].sort((a, b) => b.distance - a.distance);
  const fastestLap = hud.lapTimes.length ? Math.min(...hud.lapTimes) : null;
  const message = hud.feedbackUntil > hud.elapsed ? hud.feedback : hud.blocked ? 'TRAFFIC · FIND AN OPEN LINE' : hud.drafting ? 'SLIPSTREAM · ENERGY RECOVERING' : hud.boosting ? 'BOOST · COMMIT TO THE PASS' : hud.boostLocked ? 'RECOVER TO 28% TO BOOST AGAIN' : 'FIND YOUR RHYTHM';

  return <main className={`game-shell ${phase === 'ready' ? 'menu-shell' : 'race-shell'}`}>
    <header className="game-header"><div className="brand-lockup"><span className="brand-mark">IR</span><div><p className="eyebrow">SHORT TRACK / NIGHT CIRCUIT</p><h1>DANTE <span>// ICE RUSH</span></h1></div></div><div className="header-actions">{controller && <span className="controller-connected"><Gamepad2 size={16} /> PAD</span>}<Button variant="ghost" onClick={toggleMute} aria-label={muted ? 'Unmute game sound' : 'Mute game sound'} title="Sound · M">{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</Button><Button variant="ghost" onClick={toggleQuality} aria-label={`Graphics: ${quality ? 'high' : 'balanced'}. Click to change.`}><Gauge size={17} /><span>{quality ? 'HIGH' : 'BALANCED'}</span></Button>{phase !== 'ready' && <Button variant="ghost" onClick={cycleCamera} aria-label="Switch camera" title="Camera · C"><Camera size={18} /><span>{camera === 'chase' ? 'CHASE' : 'TACTICAL'}</span></Button>}{active && <Button variant="ghost" onClick={pauseRace} aria-label="Pause race"><Pause size={18} /><span>ESC</span></Button>}</div></header>
    <section className={`arena-frame ${phase === 'ready' ? 'is-selecting' : ''} ${hud.boosting && phase === 'racing' ? 'is-boosting' : ''}`} aria-label="3D speed skating arena">
      <div ref={stageRef} className="race-stage" role="img" aria-label={`${selected.name} in the 3D ice arena`} />
      {phase !== 'ready' && phase !== 'finished' && <><div className="race-topline"><span>{config.mode === 'time-trial' ? 'TIME TRIAL' : `${config.difficulty.toUpperCase()} RACE`}</span><b className={lap === 3 ? 'final-lap' : ''}>{lap === 3 ? 'FINAL LAP' : `LAP ${lap} / ${LAPS}`}</b><span>{formatTime(hud.elapsed)}</span></div><div className="race-leaderboard"><p>{config.mode === 'race' ? 'RACE ORDER' : 'PERSONAL GHOST'}</p>{config.mode === 'race' ? leaderboard.map((r, i) => <div key={r.id} className={r.player ? 'is-player' : ''}><b>{i + 1}</b><i style={{ background: `#${r.accent.toString(16).padStart(6, '0')}` }} /><span>{r.name}{r.player ? ' · YOU' : ''}</span><small>{r.player ? '' : `${r.distance > hud.distance ? '+' : '−'}${Math.abs(r.distance - hud.distance).toFixed(1)}m`}</small></div>) : <><strong className="ghost-delta">{ghostGap === null ? 'SET A TIME' : `${ghostGap >= 0 ? '+' : '−'}${Math.abs(ghostGap).toFixed(1)}m`}</strong><span>{ghostGap === null ? 'Your next run will have a ghost.' : ghostGap >= 0 ? 'Ahead of your best run' : 'Chasing your best run'}</span></>}<MiniMap game={hud} ghost={ghost} /></div><div className="speed-panel"><span>{selected.name.toUpperCase()}</span><strong>{Math.round(hud.speed * 3.6)}<small>KM/H</small></strong><div className={`energy-label ${hud.boostLocked ? 'is-empty' : ''}`}><Zap size={14} />{hud.boosting ? 'BOOSTING' : hud.boostLocked ? 'RECOVERING' : 'BOOST'}<b>{Math.round(hud.stamina)}%</b></div><div className="energy-meter"><i style={{ width: `${hud.stamina}%` }} /></div><p>{hud.drafting ? 'SLIPSTREAM + ENERGY' : `${Math.max(0, Math.ceil(RACE_DISTANCE - hud.distance))}m TO FINISH`}</p></div>{hud.lapTimes.length > 0 && <div className="split-panel">{hud.lapTimes.map((time, i) => <span key={i}>L{i + 1}<b>{time.toFixed(2)}s</b></span>)}</div>}{phase === 'racing' && <div className="stride-coach"><div className={`race-feedback ${hud.combo ? 'is-perfect' : ''}`} aria-live="polite">{message}</div><div className="timing-bar" aria-hidden="true"><i className="timing-window" /><b style={{ left: `${timing * 100}%` }} /></div><div className="timing-instruction"><kbd className={nextFoot === 'A' ? 'next-foot' : ''}>A</kbd><span>Tap <b>{nextFoot}</b> in the bright zone · or hold <b>W</b></span><kbd className={nextFoot === 'D' ? 'next-foot' : ''}>D</kbd></div></div>}<div className="race-progress"><i style={{ width: `${Math.min(100, hud.distance / RACE_DISTANCE * 100)}%` }} /></div></>}
      {phase === 'ready' && <div className="start-screen"><div className="character-spotlight"><figure className="character-photo"><img key={selected.id} src={selected.photo} alt={`${selected.name} artwork in ${selected.colors.toLowerCase()} with uncovered steel blades`} width={1024} height={1536} fetchPriority="high" /><figcaption><span>{selected.name.toUpperCase()} · {selected.number}</span>{selected.colors}</figcaption></figure><div className="spotlight-tag">333 METRES. ONE FINISH LINE.</div></div><div className="start-copy"><p className="eyebrow red" id="character-selection-label">CHOOSE YOUR SKATER</p><h2>{selected.name.toUpperCase()}</h2><p className="role">#{selected.number} · {selected.colors}</p><RadioGroup value={selectedId} onValueChange={chooseCharacter} aria-labelledby="character-selection-label" className="character-options">{CHARACTERS.map((c, i) => <label key={c.id} htmlFor={`character-${c.id}`} className={`character-option ${c.id === selectedId ? 'is-selected' : ''}`}><RadioGroupItem id={`character-${c.id}`} value={c.id} className="character-radio" /><span className="character-option-image"><img src={c.photo} alt="" width={1024} height={1536} /><kbd>{i + 1}</kbd></span><span className="character-option-name">{c.name}</span></label>)}</RadioGroup><p className="setup-label" id="mode-label">THE CHALLENGE</p><RadioGroup value={config.mode} onValueChange={mode => configure({ ...configRef.current, mode: mode as RaceMode })} aria-labelledby="mode-label" className="mode-options">{[{ id: 'race', name: 'PACK RACE', detail: 'Outsmart three rivals' }, { id: 'time-trial', name: 'TIME TRIAL', detail: 'Set a time. Beat your ghost.' }].map(m => <label key={m.id} className={config.mode === m.id ? 'chosen' : ''}><RadioGroupItem value={m.id} /><Flag size={16} /><span><b>{m.name}</b><small>{m.detail}</small></span></label>)}</RadioGroup>{config.mode === 'race' && <RadioGroup value={config.difficulty} onValueChange={difficulty => configure({ ...configRef.current, difficulty: difficulty as Difficulty })} aria-label="Race difficulty" className="difficulty-options">{DIFFICULTIES.map(d => <label key={d.id} title={d.detail} className={config.difficulty === d.id ? 'chosen' : ''}><RadioGroupItem value={d.id} /><span>{d.name}</span></label>)}</RadioGroup>}<div className="quick-guide"><b>HOLD W</b> to skate. <b>↑ ↓</b> to pass. <b>SPACE</b> to boost.<small>Want more speed? Alternate A / D in rhythm.</small></div><Button disabled={graphicsError} onClick={startRace} size="lg" className="start-button"><Play fill="currentColor" /> RACE AS {selected.name.toUpperCase()} <kbd>ENTER</kbd></Button><p className="best-time">{best ? `PERSONAL BEST ${formatTime(best.time)}` : 'YOUR FIRST FINISH SETS THE BENCHMARK'}</p></div></div>}
      {phase === 'countdown' && <div className="countdown"><span key={countdown}>{countdown || 'GO'}</span><p>HOLD W TO SKATE · SPACE TO BOOST</p></div>}
      {phase === 'paused' && !graphicsError && <div className="pause-screen"><div className="pause-card"><p className="eyebrow red">TAKE A BREATH</p><h2>PAUSED</h2><p>Your race clock is stopped.</p><Button className="start-button" onClick={resumeRace}><Play /> RESUME <kbd>ESC</kbd></Button><Button variant="ghost" onClick={startRace}><RotateCcw size={16} /> RESTART RACE</Button><Button variant="ghost" onClick={returnToSelection}><Home size={16} /> CHARACTER MENU</Button><small>W skate · A/D rhythm · ↑↓ line · Space boost · C camera · M sound</small></div></div>}
      {phase === 'finished' && <div className="finish-screen"><div className="finish-card polished-finish"><Trophy /><p className="eyebrow red">{newBest ? 'NEW PERSONAL BEST' : 'RACE COMPLETE'}</p><h2>{config.mode === 'time-trial' ? 'TIME SET' : ordinal(hud.position)}</h2><p className="finish-time">{formatTime(hud.finishTime ?? hud.elapsed)}</p><p>{config.mode === 'time-trial' ? 'Your best run is ready to race as a ghost.' : hud.position === 1 ? `${selected.name} takes the win.` : 'Find the slipstream. Choose your moment.'}</p><div className="result-stats"><span><b>{Math.round(hud.topSpeed * 3.6)}</b>TOP KM/H</span><span><b>{hud.bestCombo}×</b>BEST COMBO</span><span><b>{hud.perfectStrides}</b>PERFECT STRIDES</span></div><div className="result-laps">{hud.lapTimes.map((time, i) => <span key={i} className={time === fastestLap ? 'fastest' : ''}>LAP {i + 1}<b>{time.toFixed(2)}s</b>{time === fastestLap && <small>FASTEST</small>}</span>)}</div><p className="result-tip">{hud.draftSeconds >= 2 ? `${hud.draftSeconds.toFixed(1)} seconds in the slipstream. ` : ''}{hud.bestCombo >= 8 ? 'Excellent rhythm. Time your boost for the final straight.' : 'Perfect-stride streaks reward you with speed and energy.'}</p><Button onClick={startRace} size="lg" className="start-button"><RotateCcw /> {config.mode === 'time-trial' ? 'CHASE YOUR GHOST' : 'RACE AGAIN'} <kbd>ENTER</kbd></Button><Button onClick={returnToSelection} variant="ghost" className="choose-again-button">CHOOSE CHARACTER / CHALLENGE</Button>{storageWarning && <small className="storage-warning">Saving unavailable; this session still remembers your record.</small>}</div></div>}
      {graphicsError && <div className="pause-screen"><div className="pause-card"><h2>ICE BREAK</h2><p>The 3D renderer is unavailable. Enable hardware acceleration in your PC browser, then reload.</p><Button className="start-button" onClick={() => window.location.reload()}><RotateCcw /> RELOAD GAME</Button></div></div>}
    </section>
    <footer className="control-deck interactive-deck"><div className="deck-skate"><Button {...hold('KeyW')} disabled={!active} className="deck-button skate-button"><Play size={15} /> HOLD TO SKATE <kbd>W</kbd></Button><div><Button onClick={() => manualStride('A')} disabled={phase !== 'racing'} className="foot-button">A</Button><span>RHYTHM</span><Button onClick={() => manualStride('D')} disabled={phase !== 'racing'} className="foot-button">D</Button></div></div><div className="deck-line"><Button disabled={phase !== 'racing'} onClick={() => changeLane(gameRef.current, -1)} className="deck-button"><ArrowUp size={15} /> INSIDE</Button><Button disabled={phase !== 'racing'} onClick={() => changeLane(gameRef.current, 1)} className="deck-button"><ArrowDown size={15} /> OUTSIDE</Button></div><Button {...hold('Space')} disabled={!active} className={`deck-button boost-button ${hud.boosting && phase === 'racing' ? 'boost-active' : ''}`}><Zap size={16} /> HOLD TO BOOST <kbd>SPACE</kbd></Button><div className="race-tip"><span>{controller ? 'CONTROLLER READY' : 'RACE SMART'}</span>{controller ? 'A skate · RT boost · Stick steer · LB/RB stride · Start pause' : hud.blocked && phase === 'racing' ? 'The line is blocked. Move outside to complete the pass.' : 'Recover energy in a rival’s slipstream. Move out and boost past.'}</div></footer>
  </main>;
}
