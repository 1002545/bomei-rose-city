/** Handwired v7 gameplay adapters: passenger flow, seated-dog beat, NPC destination choice.
 *
 * No compiler in the browser and no silent fallback. Every native path is either the explicit
 * `?handwired=native` diagnostic mode or a counted domain/boundary compatibility path. Malformed
 * engine output throws. FP64 state stays in the game; the graphs receive an exact encoding
 *   hi = Math.fround(x), lo = sign(x - hi)
 * so that FP64 comparisons against FP32-representable thresholds are decided exactly in-circuit.
 */
const f32 = Math.fround;
const RANGE = 2 ** 20, BIG = 2 ** 40, CLOCK = 2 ** 50, MOD = 27720, SLOTS = 12;
const DOG_EDGES = [9.5, 11.35, 14.8, 28, 29.4, 32.6, 39.5 + .15, 42.8, 45, 47.4];
const RING = [39.5, 41.7];
// A non-FP32 threshold c is undecidable from hi only when hi === fround(c).
const DOG_BAND = new Set([...DOG_EDGES, ...RING].filter(c => f32(c) !== c).map(c => f32(c)));
const NIGHT = ['courtyard', 'promenade', 'garden'];
const sign = r => (r > 0 ? 1 : r < 0 ? -1 : 0);

/** Packed passenger code: bit0 beforeClose (checkIn blocked), bit1 boardable, bit2 landed, bits3-5 message, bit6 scanReject.
 * Native references, written to mirror the bundle code exactly (tests compare them to the bundle). */
export function passengerNative(t, total) {
  const dep = t.departure;
  const beforeClose = dep !== null && total < dep - 2;
  const boardable = dep !== null && t.security === dep && total >= dep - 15 && total < dep - 2;
  const message = dep === null || total >= dep && !t.boarded ? 0 : t.security === dep ? total < dep - 15 ? 2 : total >= dep - 2 && !t.boarded ? 3 : 4 : 1;
  const landed = dep !== null && total >= dep + 20;
  const scanReject = dep === null || total >= dep - 2;
  return +beforeClose | +boardable << 1 | +landed << 2 | message << 3 | +scanReject << 6;
}
export function dogBeatNative(t) {
  const beat = t < 9.5 ? 0 : t < 11.35 ? 1 : t < 14.8 ? 2 : t < 28 ? 3 : t < 29.4 ? 4 : t < 32.6 ? 5 : t < RING[0] + .15 ? 6 : t < 42.8 ? 7 : t < 45 ? 8 : t < 47.4 ? 9 : 10;
  return beat | +(t >= RING[0] && t < RING[1]) << 4;
}

function counter() { return {calls: 0, graphCalls: 0, weighted: 0, native: 0, domainFallbacks: 0, boundaryFallbacks: 0, memoHits: 0, errors: 0}; }

export function createGameplayV7Logic(engine, {mode = 'weights', warn = console.warn} = {}) {
  if (mode !== 'weights' && mode !== 'native') throw Error('Handwired v7 invalid mode ' + mode);
  if (mode === 'weights' && typeof engine?.evaluate !== 'function') throw Error('Handwired v7 weight engine required');
  const kernels = {passengerFlow7: counter(), dogBeat7: counter(), npcDestination7: counter()};
  const inputs = {passenger: new Float32Array(7), dog: new Float32Array(2), destination: new Float32Array(4 + 4 * SLOTS)};
  const warned = new Set();
  let busy = false; // single synchronous evaluation buffer per graph; reentry would be a bug
  function fallback(k, name, reason) {
    k.native++;
    if (reason) {
      k[reason]++;
      const key = name + ':' + reason;
      if (!warned.has(key)) { warned.add(key); warn('[博美 Handwired v7] explicit native compatibility path: ' + key); }
    }
  }
  function run(k, graph, input, check) {
    if (busy) throw Error('Handwired v7 reentrant evaluation');
    busy = true;
    try {
      const out = engine.evaluate(graph, input);
      k.graphCalls++;
      if (!check(out)) throw Error('Handwired v7 malformed output from ' + graph);
      k.weighted++;
      return out;
    } catch (error) { k.errors++; throw error; } finally { busy = false; }
  }
  const isBit = x => x === 0 || x === 1;
  const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

  function passengerFlow7(t, total) {
    const k = kernels.passengerFlow7; k.calls++;
    if (mode === 'native') { k.native++; return passengerNative(t, total); }
    const dep = t?.departure, sec = t?.security;
    if (!t || !Number.isFinite(total) || Math.abs(total) > BIG || typeof t.boarded !== 'boolean' ||
        !(dep === null || Number.isInteger(dep) && dep >= 42 && dep <= BIG) || !(sec === null || Number.isFinite(sec))) {
      fallback(k, 'passengerFlow7', 'domainFallbacks'); return passengerNative(t, total);
    }
    const x = inputs.passenger; x.fill(0);
    if (dep !== null) {
      // dep >= 42 is an integer: total - dep is exact wherever a threshold in [-15, 20] could flip.
      const d = total - dep, dHi = f32(d);
      x[0] = 1; x[1] = dHi; x[2] = sign(d - dHi);
      if (!(Math.abs(dHi) <= RANGE)) { fallback(k, 'passengerFlow7', 'domainFallbacks'); return passengerNative(t, total); }
      if (sec !== null) {
        const s = sec - dep, sHi = f32(s);
        if (!(Math.abs(sHi) <= RANGE)) { fallback(k, 'passengerFlow7', 'domainFallbacks'); return passengerNative(t, total); }
        x[3] = 1; x[4] = sHi; x[5] = sign(s - sHi);
      }
    }
    x[6] = +t.boarded;
    const out = run(k, 'passenger7_flow', x, o => o.length === 5 && isBit(o[0]) && isBit(o[1]) && isInt(o[2], 0, 4) && isBit(o[3]) && isBit(o[4]));
    return out[0] | out[1] << 1 | out[3] << 2 | out[2] << 3 | out[4] << 6;
  }

  let lastT = NaN, lastCode = 0;
  function dogBeat7(t) {
    const k = kernels.dogBeat7; k.calls++;
    if (mode === 'native') { k.native++; return dogBeatNative(t); }
    if (t === lastT) { k.memoHits++; return lastCode; }
    if (!(Number.isFinite(t) && t >= 0 && t <= 48)) { fallback(k, 'dogBeat7', 'domainFallbacks'); return dogBeatNative(t); }
    const hi = f32(t);
    if (DOG_BAND.has(hi)) { fallback(k, 'dogBeat7', 'boundaryFallbacks'); return dogBeatNative(t); }
    const x = inputs.dog; x[0] = hi; x[1] = sign(t - hi);
    const out = run(k, 'dog7_beat', x, o => o.length === 2 && isInt(o[0], 0, 10) && isBit(o[1]));
    lastT = t; lastCode = out[0] | out[1] << 4;
    return lastCode;
  }

  /** places/hours/rotation as in bundle `ES`; `native` is the untouched original function. */
  function npcDestination7(def, time, companion, hours, hashValue, native) {
    const k = kernels.npcDestination7; k.calls++;
    if (typeof native !== 'function') throw Error('Handwired v7 destination needs the native ES reference');
    if (mode === 'native') { k.native++; return native(def, time, companion); }
    const hour = time?.hour, total = time?.total;
    const places = companion && def.companionPlaces ? [...new Set([...def.places, ...def.companionPlaces])] : def.places;
    if (!Number.isFinite(hour) || hour < 0 || hour > 24 || !Number.isFinite(total) || Math.abs(total) > CLOCK ||
        !isInt(hashValue, 0, 2 ** 32 - 1) || !Array.isArray(places) || places.length > SLOTS || !hours) {
      fallback(k, 'npcDestination7', 'domainFallbacks'); return native(def, time, companion);
    }
    const x = inputs.destination; x.fill(0);
    const hHi = f32(hour), slot = Math.floor(total / 120);
    x[0] = hHi; x[1] = sign(hour - hHi); x[2] = (slot % MOD + MOD) % MOD; x[3] = hashValue % MOD;
    for (let i = 0; i < places.length; i++) {
      const h = hours[places[i]], base = 4 + 4 * i;
      x[base] = 1;
      if (h === undefined) continue;
      if (!Array.isArray(h) || !isInt(h[0], 0, 24) || !isInt(h[1], 0, 24)) { fallback(k, 'npcDestination7', 'domainFallbacks'); return native(def, time, companion); }
      x[base + 1] = 1; x[base + 2] = h[0]; x[base + 3] = h[1];
    }
    const out = run(k, 'npc7_destination', x, o => o.length === 3 && isBit(o[0]) && isBit(o[1]) && isInt(o[2], 0, SLOTS - 1));
    if (out[0] === 0) { if (out[2] > 2) throw Error('Handwired v7 destination night index ' + out[2]); return NIGHT[out[2]]; }
    if (out[1] === 1) return 'plaza';
    if (out[2] >= places.length) throw Error('Handwired v7 destination slot ' + out[2] + ' outside ' + places.length);
    return places[out[2]];
  }

  function snapshot() {
    const result = {mode, calls: 0, graphCalls: 0, weighted: 0, native: 0, domainFallbacks: 0, boundaryFallbacks: 0, memoHits: 0, errors: 0, kernels: {}};
    for (const [name, c] of Object.entries(kernels)) { result.kernels[name] = {...c}; for (const key of Object.keys(c)) result[key] += c[key]; }
    return result;
  }
  return {passengerFlow7, dogBeat7, npcDestination7, snapshot};
}
