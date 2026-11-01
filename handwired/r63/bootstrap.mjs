/** R63 wallet bootstrap, chained like v6: evaluated after the base Handwired bootstrap (v6, or v7 once r52 is
 * applied) and extends globalThis.bomeiHandwired without importing any specific base version. */
import '../v7/bootstrap.mjs'; // build.mjs rewrites this to the bundle's own base (v6, or v7 after r52): an explicit dependency, because sibling TLA modules otherwise run unordered
import {loadWeightEngine} from '../phase4/performance/loader.mjs';
import {createWalletLogic} from './wallet-adapter.mjs';
const baseRuntime = globalThis.bomeiHandwired;
if (!baseRuntime?.snapshot || !baseRuntime.mode) throw Error('R63 wallet bootstrap must be imported after the Handwired base bootstrap');
let engine;
try { engine = await loadWeightEngine(new URL('./artifacts/game-weights-hw63.manifest.json', import.meta.url)); }
catch (error) {
  const text = globalThis.document?.getElementById('loading-text');
  if (text) text.textContent = '神经网络钱包权重加载失败，请刷新重试。' + error.message;
  globalThis.document?.getElementById('loading')?.classList.add('load-error');
  const retry = globalThis.document?.getElementById('load-retry');
  if (retry) { retry.hidden = false; retry.onclick = () => globalThis.location.reload(); }
  if (globalThis.document?.body) globalThis.document.body.dataset.handwired = 'error';
  throw error;
}
export const bomeiR63Wallet = createWalletLogic(engine, {mode: baseRuntime.mode});
globalThis.bomeiHandwired = {...baseRuntime, walletEngine: engine,
  graphNames: [...baseRuntime.graphNames, ...engine.graphNames],
  verifiedSha256: {...baseRuntime.verifiedSha256, wallet: engine.verifiedSha256},
  coverage: {...baseRuntime.coverage, wallet: engine.manifest.coverage},
  snapshot: () => { const base = baseRuntime.snapshot(); return {...base, wallet: bomeiR63Wallet.snapshot(), engineCalls: base.engineCalls + engine.callCount, perGraph: {...base.perGraph, ...engine.calls}}; }};
