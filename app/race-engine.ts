import { RACE_ROSTER, type CharacterId } from './characters.ts';
import { BEND_RADIUS, LAP_LENGTH, STRAIGHT_LENGTH } from './ice-track.ts';

export const LAPS = 3;
export const RACE_DISTANCE = LAPS * LAP_LENGTH;
export const STRIDE_INTERVAL = 0.38;
export const STEP = 1 / 120;
export type Difficulty = 'rookie' | 'club' | 'elite';
export type RaceMode = 'race' | 'time-trial';
export type RaceConfig = { mode: RaceMode; difficulty: Difficulty };
export const DEFAULT_CONFIG: RaceConfig = { mode: 'race', difficulty: 'rookie' };
export const DIFFICULTIES = [
  { id: 'rookie', name: 'Rookie', detail: 'Learn the racing line', pace: 11.6 },
  { id: 'club', name: 'Club', detail: 'A close, tactical race', pace: 13.0 },
  { id: 'elite', name: 'Elite', detail: 'Precision wins', pace: 14.15 },
] as const;

export type GhostSample = { t: number; distance: number; lane: number; speed: number };
export type Rival = { id: string; name: string; accent: number; distance: number; lane: number; targetLane: number; speed: number; pace: number; finishTime: number | null };
export type RaceEvent = 'lap' | 'pass' | 'finish';
export type RaceState = {
  characterId: CharacterId; config: RaceConfig; distance: number; speed: number;
  lane: number; targetLane: number; stamina: number; rhythm: number; elapsed: number;
  lastStrideAt: number; lastStrideKey: 'A' | 'D' | ''; combo: number; bestCombo: number;
  perfectStrides: number; strides: number; topSpeed: number; drafting: boolean;
  draftSeconds: number; boosting: boolean; boostLocked: boolean; blocked: boolean;
  feedback: string; feedbackUntil: number; overtakes: number; lapTimes: number[];
  finishTime: number | null; position: number; rivals: Rival[]; recording: GhostSample[];
};

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
export const recordKey = (config: RaceConfig) => config.mode === 'time-trial' ? 'time-trial' : `race-${config.difficulty}`;

export function createRace(characterId: CharacterId = 'dante', config: RaceConfig = DEFAULT_CONFIG): RaceState {
  const pace = DIFFICULTIES.find(d => d.id === config.difficulty)!.pace;
  const rivals = config.mode === 'race' ? RACE_ROSTER.filter(r => r.id !== characterId).map((r, i) => ({
    id: r.id, name: r.name, accent: r.primary, distance: [1.7, -1.7, -3.8][i],
    lane: [0, 2, 0][i], targetLane: [0, 2, 0][i], speed: 7.6,
    pace: pace + (r.baseSpeed - 12.6) * 0.55, finishTime: null,
  })) : [];
  return {
    characterId, config: { ...config }, distance: 0, speed: 7.6, lane: 1, targetLane: 1,
    stamina: 100, rhythm: 45, elapsed: 0, lastStrideAt: -10, lastStrideKey: '', combo: 0,
    bestCombo: 0, perfectStrides: 0, strides: 0, topSpeed: 7.6, drafting: false,
    draftSeconds: 0, boosting: false, boostLocked: false, blocked: false,
    feedback: 'HOLD W TO SKATE · OR TAP A / D', feedbackUntil: 3,
    overtakes: 0, lapTimes: [], finishTime: null, position: rivals.length ? 2 : 1, rivals,
    recording: [{ t: 0, distance: 0, lane: 1, speed: 7.6 }],
  };
}

export function changeLane(game: RaceState, direction: -1 | 1) {
  game.targetLane = clamp(game.targetLane + direction, 0, 2);
}

export function stride(game: RaceState, side: 'A' | 'D', assisted = false): 'perfect' | 'good' | 'miss' | 'ignored' {
  if (game.finishTime !== null) return 'ignored';
  const gap = game.elapsed - game.lastStrideAt;
  // No speed advantage from keyboard repeat or rapid alternate-key spam.
  if (gap < 0.18) return 'ignored';
  const first = game.lastStrideKey === '' || gap > 1.6;
  const alternate = side !== game.lastStrideKey || first;
  const perfect = !assisted && alternate && !first && Math.abs(gap - STRIDE_INTERVAL) <= 0.085;
  const good = alternate && (first || (gap >= 0.22 && gap <= 0.65));
  game.lastStrideAt = game.elapsed;
  game.lastStrideKey = side;
  game.strides++;
  if (assisted) {
    game.speed += Math.max(0, Math.min(0.58, 13.25 - game.speed));
    game.rhythm = Math.min(74, game.rhythm + 7);
    game.combo = 0;
    return 'good';
  }
  if (good) {
    game.speed += Math.max(0, Math.min(perfect ? 0.77 : 0.49, 15.8 - game.speed));
    game.rhythm = clamp(game.rhythm + (perfect ? 13 : 7), 0, 100);
    game.combo = perfect ? game.combo + 1 : 0;
    game.bestCombo = Math.max(game.bestCombo, game.combo);
    if (perfect) { game.perfectStrides++; game.stamina = Math.min(100, game.stamina + 1.1); }
    game.feedback = perfect ? `PERFECT${game.combo > 1 ? ` ×${game.combo}` : ''}` : 'GOOD STRIDE';
  } else {
    game.rhythm = Math.max(0, game.rhythm - 13);
    game.speed = Math.max(5.2, game.speed - 0.3);
    game.combo = 0;
    game.feedback = alternate ? 'FIND THE BEAT' : 'ALTERNATE A ↔ D';
  }
  game.feedbackUntil = game.elapsed + 0.75;
  return perfect ? 'perfect' : good ? 'good' : 'miss';
}

export function progressRate(distance: number, lane: number) {
  const d = ((distance % LAP_LENGTH) + LAP_LENGTH) % LAP_LENGTH;
  const half = STRAIGHT_LENGTH / 2, arc = Math.PI * BEND_RADIUS;
  const corner = (d >= half && d < half + arc) || (d >= half + arc + STRAIGHT_LENGTH && d < half + arc * 2 + STRAIGHT_LENGTH);
  return corner ? BEND_RADIUS / (BEND_RADIUS + (lane - 1) * 0.95) : 1;
}

function forwardGap(a: number, b: number) {
  // Race-distance ordering remains distinct from proximity after a lap is gained.
  return ((b - a + LAP_LENGTH / 2) % LAP_LENGTH + LAP_LENGTH) % LAP_LENGTH - LAP_LENGTH / 2;
}

export function stepRace(game: RaceState, input: { skate: boolean; boost: boolean }, dt = STEP): RaceEvent[] {
  if (game.finishTime !== null || !Number.isFinite(dt) || dt <= 0) return [];
  dt = Math.min(dt, 1 / 30);
  const events: RaceEvent[] = [];
  const previousTime = game.elapsed, previousDistance = game.distance;
  game.elapsed += dt;
  if (input.skate && game.elapsed - game.lastStrideAt >= STRIDE_INTERVAL) stride(game, game.lastStrideKey === 'A' ? 'D' : 'A', true);
  const bodies = [{ distance: game.distance, lane: game.lane }, ...game.rivals];
  game.drafting = game.rivals.some(r => { const gap = forwardGap(game.distance, r.distance); return gap > 1.4 && gap < 7 && Math.abs(r.lane - game.lane) < 0.52; });
  if (game.drafting) game.draftSeconds += dt;
  game.blocked = false;
  const nextLane = game.lane + (game.targetLane - game.lane) * (1 - Math.exp(-6 * dt));
  const sidewaysBlocked = game.rivals.some(r => Math.abs(forwardGap(game.distance, r.distance)) < 1.4 && Math.abs(nextLane - r.lane) < 0.55 && Math.abs(nextLane - r.lane) < Math.abs(game.lane - r.lane));
  if (!sidewaysBlocked) game.lane = clamp(nextLane, 0, 2);
  else game.blocked = true;

  const idle = game.elapsed - game.lastStrideAt;
  game.speed = Math.max(5.2, game.speed - (idle > 0.85 ? 1.85 : game.drafting ? 0.3 : 0.8) * dt);
  game.rhythm = Math.max(0, game.rhythm - (idle > 0.85 ? 13 : 4.8) * dt);
  if (idle > 1.1) game.combo = 0;
  if (game.boostLocked && game.stamina >= 28) game.boostLocked = false;
  game.boosting = input.boost && !game.boostLocked && game.stamina > 0;
  if (game.boosting) {
    game.speed = Math.min(18, game.speed + 3.3 * dt);
    game.stamina = Math.max(0, game.stamina - 27 * dt);
    if (game.stamina === 0) { game.boostLocked = true; game.boosting = false; }
  } else {
    game.stamina = Math.min(100, game.stamina + (game.drafting ? 15 : 7.5) * dt);
    if (game.speed > 15.8) game.speed = Math.max(15.8, game.speed - dt * 1.8);
  }

  game.rivals.forEach((r, i) => {
    if (r.finishTime !== null) { r.distance += r.speed * progressRate(r.distance, r.lane) * dt; return; }
    const ahead = bodies.some(body => body !== r && forwardGap(r.distance, body.distance) > 0 && forwardGap(r.distance, body.distance) < 4.6 && Math.abs(body.lane - r.lane) < 0.6);
    // Pick the least obstructed line, favouring the inside when it is open.
    if (ahead || Math.abs(r.lane - r.targetLane) < 0.08) {
      const scores = [0, 1, 2].map(lane => {
        let score = lane * 0.9 + Math.abs(lane - r.lane) * 0.55;
        for (const body of bodies) if (body !== r && Math.abs(body.lane - lane) < 0.65) {
          const gap = forwardGap(r.distance, body.distance);
          if (gap > -1.8 && gap < 5.8) score += gap < 1.8 ? 12 : 6;
        }
        return score;
      });
      r.targetLane = scores.indexOf(Math.min(...scores));
    }
    const proposedLane = r.lane + (r.targetLane - r.lane) * (1 - Math.exp(-2.8 * dt));
    if (!bodies.some(b => b !== r && Math.abs(forwardGap(r.distance, b.distance)) < 1.45 && Math.abs(b.lane - proposedLane) < 0.55 && Math.abs(b.lane - proposedLane) < Math.abs(b.lane - r.lane))) r.lane = proposedLane;
    const finalPush = r.distance > LAP_LENGTH * 2.15 ? 0.6 : 0;
    const target = r.pace + finalPush + Math.sin(game.elapsed * 0.72 + i * 2.1) * 0.27;
    r.speed += (target - r.speed) * (1 - Math.exp(-0.9 * dt));
    const old = r.distance;
    let next = r.distance + r.speed * progressRate(r.distance, r.lane) * dt;
    for (const body of bodies) if (body !== r && Math.abs(body.lane - r.lane) < 0.52) {
      const gap = forwardGap(old, body.distance);
      if (gap > 0 && gap < 1.5) next = Math.min(next, old + Math.max(0, gap - 1.15));
    }
    r.distance = next;
    if (r.distance >= RACE_DISTANCE) r.finishTime = previousTime + dt * clamp((RACE_DISTANCE - old) / Math.max(0.00001, next - old), 0, 1);
  });

  let nextDistance = game.distance + game.speed * progressRate(game.distance, game.lane) * dt;
  for (const r of game.rivals) {
    const gap = forwardGap(game.distance, r.distance);
    if (gap > 0 && gap < 1.5 && Math.abs(r.lane - game.lane) < 0.52 && r.finishTime === null) {
      nextDistance = Math.min(nextDistance, game.distance + Math.max(0, gap - 1.15));
      game.speed = Math.min(game.speed, r.speed + 0.1);
      game.blocked = true;
    }
  }
  game.distance = nextDistance;
  game.topSpeed = Math.max(game.topSpeed, game.speed);
  const place = 1 + game.rivals.filter(r => r.distance > game.distance).length;
  if (place < game.position && game.elapsed > 1) { game.overtakes += game.position - place; events.push('pass'); }
  game.position = place;

  const line = (game.lapTimes.length + 1) * LAP_LENGTH;
  if (game.distance >= line) {
    const crossing = previousTime + dt * clamp((line - previousDistance) / Math.max(0.00001, game.distance - previousDistance), 0, 1);
    game.lapTimes.push(crossing - game.lapTimes.reduce((a, b) => a + b, 0));
    if (game.lapTimes.length < LAPS) {
      events.push('lap');
      game.feedback = game.lapTimes.length === 2 ? 'FINAL LAP · MAKE YOUR MOVE' : 'LAP 2 · STAY IN THE FIGHT';
      game.feedbackUntil = game.elapsed + 2;
    } else {
      game.finishTime = crossing;
      game.elapsed = crossing;
      game.distance = RACE_DISTANCE;
      game.position = 1 + game.rivals.filter(r => r.finishTime !== null && r.finishTime < crossing).length;
      events.push('finish');
    }
  }
  if (game.elapsed - game.recording[game.recording.length - 1].t >= 0.1 || game.finishTime !== null) {
    game.recording.push({ t: game.elapsed, distance: game.distance, lane: game.lane, speed: game.speed });
  }
  return events;
}

export function sampleGhost(samples: GhostSample[], time: number): GhostSample | null {
  if (!samples.length) return null;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (samples[mid].t < time) lo = mid + 1; else hi = mid; }
  const b = samples[lo], a = samples[Math.max(0, lo - 1)];
  const u = clamp((time - a.t) / Math.max(0.0001, b.t - a.t), 0, 1);
  return { t: time, distance: a.distance + (b.distance - a.distance) * u, lane: a.lane + (b.lane - a.lane) * u, speed: a.speed + (b.speed - a.speed) * u };
}

export type SavedRecord = { time: number; samples: GhostSample[] };
export function parseRecords(raw: string | null): Record<string, SavedRecord> {
  try {
    const parsed = JSON.parse(raw ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, SavedRecord> = {};
    for (const key of ['race-rookie', 'race-club', 'race-elite', 'time-trial']) {
      const r = parsed[key];
      if (!r || !Number.isFinite(r.time) || r.time < 10 || r.time > 180) continue;
      const samples: GhostSample[] = [];
      if (Array.isArray(r.samples) && r.samples.length <= 2000) for (const s of r.samples) {
        if (!s || ![s.t, s.distance, s.lane, s.speed].every(Number.isFinite) || s.t < 0 || s.t > r.time + 0.05 || s.distance < 0 || s.distance > RACE_DISTANCE + 0.01 || s.lane < 0 || s.lane > 2 || s.speed < 0 || s.speed > 20 || (samples.length && s.t <= samples[samples.length - 1].t)) { samples.length = 0; break; }
        samples.push({ t: s.t, distance: s.distance, lane: s.lane, speed: s.speed });
      }
      result[key] = { time: r.time, samples };
    }
    return result;
  } catch { return {}; }
}
