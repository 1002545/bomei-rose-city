/** Handwired v7: one bootstrap that loads v4, v5, v6 and v7 weights in parallel.
 *
 * Replaces the serial chain v6 -> v5 -> phase4/integration/bootstrap-hw4.mjs, where every level
 * did its own top-level await (manifest, then binary) before the next level could start. The
 * composition below reproduces those three bootstraps exactly (same adapters, API merge order,
 * duplicate checks, snapshots and globalThis.bomeiHandwired fields) and appends the v7 gameplay
 * graphs. Failures are reported in the old chain order with the old per-level texts, so a missing
 * or corrupt file fails exactly as loudly as before. The old bootstrap files stay unchanged.
 */
import {createGameLogic} from '../phase4/integration/adapter.mjs';
import {createNpcStateLogic} from '../v5/npc-adapter.mjs';
import {createNavigationLogic} from '../v5/nav-adapter.mjs';
import {createTransitLogic} from '../v5/transit-adapter.mjs';
import {createNpcSeatLogic} from '../v6/seat-adapter.mjs';
import {createGameplayV7Logic} from './gameplay-adapter.mjs';
import {fetchWeightEngine} from './parallel-loader.mjs';

const mode = new URL(globalThis.location?.href ?? 'https://localhost/').searchParams.get('handwired') === 'native' ? 'native' : 'weights';
const levels = [
  {key: 'hw4', manifest: '../artifacts/game-weights-hw4.manifest.json', text: '神经网络数值权重加载失败，请刷新重试。',
    verify: engine => { if (engine.manifest.release !== 'bomei2-hw4') throw Error('Handwired release mismatch: expected bomei2-hw4'); }},
  {key: 'hw5', manifest: '../v5/artifacts/game-weights-hw5.manifest.json', text: '神经网络玩法权重加载失败，请刷新重试。'},
  {key: 'hw6', manifest: '../v6/artifacts/game-weights-hw6.manifest.json', text: '神经网络座位权重加载失败，请刷新重试。'},
  {key: 'hw7', manifest: './artifacts/game-weights-hw7.manifest.json', text: '神经网络 v7 玩法权重加载失败，请刷新重试。'},
];
const now = () => globalThis.performance?.now?.() ?? Date.now();
const startedAt = now(), timings = levels.map(() => ({}));
// allSettled: every request is in flight at once and no rejection is left unobserved while an
// earlier level is still loading; the first failure in chain order is then reported and thrown.
const settled = await Promise.allSettled(levels.map((level, i) => fetchWeightEngine(new URL(level.manifest, import.meta.url), {timings: timings[i]}).then(engine => { level.verify?.(engine); return engine; })));
const engines = {};
for (let i = 0; i < levels.length; i++) {
  const result = settled[i], level = levels[i];
  if (result.status === 'fulfilled') { engines[level.key] = result.value; continue; }
  const error = result.reason;
  const doc = globalThis.document;
  const text = doc?.getElementById('loading-text');
  if (text) text.textContent = level.text + error.message;
  doc?.getElementById('loading')?.classList.add('load-error');
  const retry = doc?.getElementById('load-retry');
  if (retry) { retry.hidden = false; retry.onclick = () => globalThis.location.reload(); }
  if (doc?.body) doc.body.dataset.handwired = 'error';
  throw error;
}
const loadedAt = now();

function merge(target, logic) {
  for (const [name, value] of Object.entries(logic)) {
    if (name === 'stats' || name === 'snapshot') continue;
    if (Object.hasOwn(target, name)) throw Error('Duplicate neural gameplay API ' + name);
    target[name] = value;
  }
}

// --- level hw4 (as phase4/integration/bootstrap-hw4.mjs) ---
const engine = engines.hw4;
const logic4 = createGameLogic(engine, {mode});
const runtime4 = {version: 'bomei2-hw4', mode, upstreamCommit: engine.manifest.upstream.commit, verifiedSha256: engine.verifiedSha256, graphNames: engine.graphNames, coverage: engine.manifest.coverage, logic: logic4, engine, snapshot: () => ({adapter: logic4.snapshot(), engineCalls: engine.callCount, perGraph: engine.calls})};

// --- level hw5 (as v5/bootstrap.mjs) ---
const extensionEngine = engines.hw5;
const modules5 = {npcState: createNpcStateLogic(extensionEngine, {mode}), navigation: createNavigationLogic(extensionEngine, {mode}), transit: createTransitLogic(extensionEngine, {mode})};
const api5 = {};
for (const logic of [logic4, ...Object.values(modules5)]) merge(api5, logic);
api5.snapshot = () => ({base: logic4.snapshot(), modules: Object.fromEntries(Object.entries(modules5).map(([name, logic]) => [name, logic.snapshot()]))});
Object.defineProperty(api5, 'stats', {get: () => api5.snapshot()});
const runtime5 = {version: 'bomei-meme-hw5', mode, upstreamCommit: extensionEngine.manifest.upstream.commit,
  verifiedSha256: {base: runtime4.verifiedSha256, gameplay: extensionEngine.verifiedSha256},
  graphNames: [...runtime4.graphNames, ...extensionEngine.graphNames],
  coverage: {base: runtime4.coverage, gameplay: extensionEngine.manifest.coverage ?? null},
  logic: api5, engine: runtime4.engine, extensionEngine,
  snapshot: () => ({adapter: api5.snapshot(), engineCalls: runtime4.engine.callCount + extensionEngine.callCount,
    perGraph: {...runtime4.engine.calls, ...extensionEngine.calls}, baseEngineCalls: runtime4.engine.callCount, gameplayEngineCalls: extensionEngine.callCount})};

// --- level hw6 (as v6/bootstrap.mjs) ---
const seatEngine = engines.hw6;
const seatLogic = createNpcSeatLogic(seatEngine, {mode}), api6 = {};
for (const logic of [api5, seatLogic]) merge(api6, logic);
api6.snapshot = () => ({base: api5.snapshot(), seat: seatLogic.snapshot()});
Object.defineProperty(api6, 'stats', {get: () => api6.snapshot()});
const runtime6 = {...runtime5, version: 'bomei-meme-hw6', logic: api6, seatEngine,
  graphNames: [...runtime5.graphNames, ...seatEngine.graphNames],
  verifiedSha256: {...runtime5.verifiedSha256, seat: seatEngine.verifiedSha256},
  coverage: {...runtime5.coverage, seat: seatEngine.manifest.coverage},
  snapshot: () => { const base = runtime5.snapshot(); return {...base, adapter: api6.snapshot(), engineCalls: base.engineCalls + seatEngine.callCount, seatEngineCalls: seatEngine.callCount, perGraph: {...base.perGraph, ...seatEngine.calls}}; }};

// --- level hw7 ---
const gameplay7Engine = engines.hw7;
const gameplay7 = createGameplayV7Logic(gameplay7Engine, {mode}), api = {};
for (const logic of [api6, gameplay7]) merge(api, logic);
api.snapshot = () => ({base: api6.snapshot(), gameplay7: gameplay7.snapshot()});
Object.defineProperty(api, 'stats', {get: () => api.snapshot()});
export const bomeiHW = api;
const startup = Object.freeze({parallel: true, loadMs: loadedAt - startedAt, composeMs: now() - loadedAt,
  levels: Object.fromEntries(levels.map((level, i) => [level.key, Object.freeze({...timings[i], start: timings[i].start - startedAt, end: timings[i].end - startedAt})]))});
globalThis.bomeiHandwired = {...runtime6, version: 'bomei-meme-hw7', logic: api, gameplay7Engine, startup,
  graphNames: [...runtime6.graphNames, ...gameplay7Engine.graphNames],
  verifiedSha256: {...runtime6.verifiedSha256, gameplay7: gameplay7Engine.verifiedSha256},
  coverage: {...runtime6.coverage, gameplay7: gameplay7Engine.manifest.coverage},
  snapshot: () => { const base = runtime6.snapshot(); return {...base, adapter: api.snapshot(), engineCalls: base.engineCalls + gameplay7Engine.callCount, gameplay7EngineCalls: gameplay7Engine.callCount, perGraph: {...base.perGraph, ...gameplay7Engine.calls}}; }};
if (globalThis.document?.body) globalThis.document.body.dataset.handwired = mode;
