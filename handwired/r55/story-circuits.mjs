/* r55-story handwired circuits: native reference + weight adapter (browser + node).
 * Three bounded, story-only kernels (never used in normal play):
 *   elevator  (elapsed s since the cabin call, floors to travel) -> phase, doors, height, floors passed, arrow, canBoard
 *   door      (open progress, actor box in hinge space)          -> leaf angle, barrier, sweep-clear
 *   cue       (shot time, 8 sorted key times + inverse spans)    -> active key index, u, eased u
 * The native functions below ARE the gameplay definition; the graphs compiled by
 * layers/r55-story/handwired/build-circuits.mjs reproduce them. The adapter keeps
 * FP64 inputs, routes inputs that sit within the FP32 resolution of a discrete
 * boundary (or outside the compiled domain) to native and COUNTS every such call
 * (stats.boundaryRepairs / stats.outOfDomain). Tensor failures throw; nothing is
 * swallowed. `?handwired=native` selects mode 'native'.
 */
export const ELEVATOR = Object.freeze({ storey: 3.3, vmax: 5, accel: 2.5, closing: 1.2, lock: 0.25, leveling: 0.35, opening: 1.15, minSpan: 4, maxSpan: 15 });
export const DOOR = Object.freeze({ maxAngle: 100 * Math.PI / 180, barrierOpenAt: 0.96, leaf: 0.92, pad: 0.03, knots: 11 });
export const CUE = Object.freeze({ keys: 8, tMin: -1, tMax: 120 });

export const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/** Elevator timing breakpoints (seconds since the call) for a trip of `span` storeys (integer 4..15). */
export function elevatorTimes(span) {
  const E = ELEVATOR, ta = E.vmax / E.accel, dA = 0.5 * E.accel * ta * ta, D = span * E.storey;
  const t1 = E.closing, t2 = t1 + E.lock, t3 = t2 + ta, tc = (D - 2 * dA) / E.vmax, t4 = t3 + tc, t5 = t4 + ta, t6 = t5 + E.leveling, t7 = t6 + E.opening;
  return { ta, dA, D, t1, t2, t3, t4, t5, t6, t7 };
}
export const ELEVATOR_PHASES = Object.freeze(['closing', 'locking', 'accelerating', 'cruising', 'decelerating', 'leveling', 'opening', 'open']);
/** Native elevator cycle. e<0 = waiting open at the origin floor before the call. */
export function nativeElevator(e, span) {
  if (!Number.isFinite(e) || !Number.isInteger(span) || span < ELEVATOR.minSpan || span > ELEVATOR.maxSpan) throw Error(`r55 elevator: invalid input e=${e} span=${span}`);
  const T = elevatorTimes(span), a = ELEVATOR.accel;
  let phase, height, doors;
  if (e < 0) { phase = 7; height = 0; doors = 1; }
  else if (e < T.t1) { phase = 0; height = 0; doors = 1 - smooth(e / ELEVATOR.closing); }
  else if (e < T.t2) { phase = 1; height = 0; doors = 0; }
  else if (e < T.t3) { phase = 2; height = 0.5 * a * (e - T.t2) ** 2; doors = 0; }
  else if (e < T.t4) { phase = 3; height = T.dA + ELEVATOR.vmax * (e - T.t3); doors = 0; }
  else if (e < T.t5) { phase = 4; height = T.D - 0.5 * a * (T.t5 - e) ** 2; doors = 0; }
  else if (e < T.t6) { phase = 5; height = T.D; doors = 0; }
  else if (e < T.t7) { phase = 6; height = T.D; doors = smooth((e - T.t6) / ELEVATOR.opening); }
  else { phase = 7; height = T.D; doors = 1; }
  const floors = Math.floor(height / ELEVATOR.storey + 0.5);
  const arrow = e >= 0 && e < T.t5 ? 1 : 0;
  return { phase, phaseName: ELEVATOR_PHASES[phase], doors, height, floors, arrow, canBoard: phase === 7 ? 1 : 0, total: T.t7 };
}

/** Door sweep box knots: hinge space, closed leaf along +x, opening swings toward -z. */
export function doorKnots() {
  const out = [];
  for (let i = 0; i < DOOR.knots; i++) {
    const p = i / (DOOR.knots - 1), th = DOOR.maxAngle * smooth(p), L = DOOR.leaf, P = DOOR.pad;
    // AABB of the swept sector [0, th] (leaf from the hinge, length L), padded.
    const xs = [L, L * Math.cos(th), 0], zs = [0, -L * Math.sin(th)];
    if (th > Math.PI / 2) zs.push(-L);
    out.push({ p, xMin: Math.min(...xs) - P, xMax: Math.max(...xs) + P, zMin: Math.min(...zs) - P, zMax: Math.max(...zs) + P });
  }
  return out;
}
const KNOTS = doorKnots();
const f32 = Math.fround;
/** Native door: progress p in [0,1]; actor = axis-aligned box centre (ax, az) half-size r in hinge space. */
export function nativeDoor(p, ax, az, r) {
  if (![p, ax, az, r].every(Number.isFinite) || p < 0 || p > 1 || r < 0) throw Error(`r55 door: invalid input ${[p, ax, az, r]}`);
  const angle = DOOR.maxAngle * smooth(p);
  const barrier = p < DOOR.barrierOpenAt ? 1 : 0;
  const n = DOOR.knots - 1, i = Math.min(n - 1, Math.floor(p * n)), u = p * n - i, k0 = KNOTS[i], k1 = KNOTS[i + 1];
  const lerp = (a, b) => f32(a) + (f32(b) - f32(a)) * u; // knot table is FP32 data (shared with the graph)
  const box = { xMin: lerp(k0.xMin, k1.xMin), xMax: lerp(k0.xMax, k1.xMax), zMin: lerp(k0.zMin, k1.zMin), zMax: lerp(k0.zMax, k1.zMax) };
  const margin = Math.max(box.xMin - (ax + r), (ax - r) - box.xMax, box.zMin - (az + r), (az - r) - box.zMax);
  const hit = p > 0 && margin < 0;
  return { angle, barrier, clear: hit ? 0 : 1, margin, box };
}

/** Native cue lookup. keys: up to 8 ascending times (unused = CUE.tMax). */
export function cueTable(times) {
  if (!Array.isArray(times) || !times.length || times.length > CUE.keys) throw Error('r55 cue: 1..8 key times required');
  const t = [...times];
  for (let i = 0; i < t.length; i++) if (!Number.isFinite(t[i]) || t[i] < CUE.tMin || t[i] > CUE.tMax || (i && t[i] <= t[i - 1])) throw Error(`r55 cue: key times must be ascending within ${CUE.tMin}..${CUE.tMax}`);
  while (t.length < CUE.keys) t.push(CUE.tMax);
  const inv = t.map((x, i) => (i + 1 < t.length && t[i + 1] > x ? 1 / (t[i + 1] - x) : 0));
  return { times: t, inv, count: times.length };
}
export function nativeCue(time, table) {
  if (!Number.isFinite(time) || time < CUE.tMin || time > CUE.tMax) throw Error(`r55 cue: time ${time} outside ${CUE.tMin}..${CUE.tMax}`);
  let index = -1;
  for (let i = 0; i < CUE.keys; i++) if (time >= table.times[i]) index = i;
  if (index < 0) return { index: -1, u: 0, eased: 0 };
  const u = Math.max(0, Math.min(1, (time - table.times[index]) * table.inv[index]));
  return { index, u, eased: smooth(u) };
}

// ---------------------------------------------------------------- weight adapter
const finite = (o) => { for (let i = 0; i < o.length; i++) if (!Number.isFinite(o[i])) return false; return true; };
export function createStoryCircuits(engine, { mode = 'weights', eps = 2e-5 } = {}) {
  if (!['weights', 'native'].includes(mode)) throw Error('r55 circuits: invalid mode ' + mode);
  if (mode === 'weights' && typeof engine?.evaluate !== 'function') throw Error('r55 circuits: weight engine required');
  const stats = { mode, calls: 0, graphCalls: 0, native: 0, boundaryRepairs: 0, outOfDomain: 0 };
  const inE = new Float32Array(2), inD = new Float32Array(4), inC = new Float32Array(17);
  const near = (x, list) => list.some((b) => Math.abs(x - b) <= eps * Math.max(1, Math.abs(b)));
  function elevator(e, span) {
    stats.calls++;
    if (mode === 'native') { stats.native++; return nativeElevator(e, span); }
    if (!Number.isInteger(span) || span < ELEVATOR.minSpan || span > ELEVATOR.maxSpan || !(e >= -1 && e <= 40)) { stats.native++; stats.outOfDomain++; return nativeElevator(e, span); }
    const T = elevatorTimes(span);
    if (near(e, [0, T.t1, T.t2, T.t3, T.t4, T.t5, T.t6, T.t7])) { stats.native++; stats.boundaryRepairs++; return nativeElevator(e, span); }
    inE[0] = e; inE[1] = span;
    const o = engine.evaluate('r55_elevator_cycle', inE); stats.graphCalls++;
    if (o.length !== 6 || !finite(o) || !Number.isInteger(o[0]) || o[0] < 0 || o[0] > 7 || !Number.isInteger(o[3]) || (o[4] !== 0 && o[4] !== 1) || o[5] !== +(o[0] === 7)) throw Error('r55 circuits: invalid elevator graph output');
    // A storey crossing within FP32 resolution of the graph's own height is repaired natively (counted).
    const s = o[2] / ELEVATOR.storey - 0.5;
    if (Math.abs(s - Math.round(s)) <= 1e-4) { stats.native++; stats.boundaryRepairs++; return nativeElevator(e, span); }
    return { phase: o[0], phaseName: ELEVATOR_PHASES[o[0]], doors: o[1], height: o[2], floors: o[3], arrow: o[4], canBoard: o[5], total: T.t7 };
  }
  function door(p, ax, az, r) {
    stats.calls++;
    if (mode === 'native') { stats.native++; return nativeDoor(p, ax, az, r); }
    if (!(p >= 0 && p <= 1) || !(Math.abs(ax) <= 4 && Math.abs(az) <= 4 && r >= 0 && r <= 1)) { stats.native++; stats.outOfDomain++; return nativeDoor(p, ax, az, r); }
    const knotEdges = []; for (let i = 0; i < DOOR.knots; i++) knotEdges.push(i / (DOOR.knots - 1));
    if (near(p, [...knotEdges, DOOR.barrierOpenAt])) { stats.native++; stats.boundaryRepairs++; return nativeDoor(p, ax, az, r); }
    inD[0] = p; inD[1] = ax; inD[2] = az; inD[3] = r;
    const o = engine.evaluate('r55_door_swing', inD); stats.graphCalls++;
    if (o.length !== 4 || !finite(o) || (o[1] !== 0 && o[1] !== 1) || (o[2] !== 0 && o[2] !== 1)) throw Error('r55 circuits: invalid door graph output');
    // o[3] = signed sweep separation (>=0 clear). Touching within FP32 resolution is repaired natively (counted).
    if (Math.abs(o[3]) <= eps) { stats.native++; stats.boundaryRepairs++; return nativeDoor(p, ax, az, r); }
    return { angle: o[0], barrier: o[1], clear: o[2], margin: o[3] };
  }
  function cue(time, table) {
    stats.calls++;
    if (mode === 'native') { stats.native++; return nativeCue(time, table); }
    if (!(time >= CUE.tMin && time <= CUE.tMax)) { stats.native++; stats.outOfDomain++; return nativeCue(time, table); }
    if (near(time, table.times)) { stats.native++; stats.boundaryRepairs++; return nativeCue(time, table); }
    inC[0] = time; for (let i = 0; i < 8; i++) { inC[1 + i] = table.times[i]; inC[9 + i] = table.inv[i]; }
    const o = engine.evaluate('r55_story_cue', inC); stats.graphCalls++;
    if (o.length !== 3 || !finite(o) || !Number.isInteger(o[0]) || o[0] < -1 || o[0] > 7) throw Error('r55 circuits: invalid cue graph output');
    return { index: o[0], u: o[1], eased: o[2] };
  }
  return { elevator, door, cue, snapshot: () => ({ ...stats }), mode };
}

/** Browser loader: fetch + verify the r55 bundle through the project's phase4 loader. */
export async function loadStoryCircuits({ mode = 'weights', base = '/handwired/r55/' } = {}) {
  if (mode === 'native') return createStoryCircuits(null, { mode });
  const { loadWeightEngine } = await import('../phase4/performance/loader.mjs');
  const engine = await loadWeightEngine(base + 'game-weights-r55.manifest.json');
  return createStoryCircuits(engine, { mode });
}
