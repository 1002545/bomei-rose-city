/** Parallel-ready weight fetch for the v7 bootstrap.
 *
 * Same validation and error texts as phase4/performance/loader.mjs#loadWeightEngine (which stays
 * byte-identical for the frozen v4 checksum list). Differences:
 *  - the caller starts every bundle at once instead of one top-level await per bootstrap level;
 *  - a binary whose file name carries the first 12 hex digits of its declared SHA-256 is
 *    content-addressed, so it is fetched with normal HTTP caching (cache: 'default'). The bytes
 *    are still SHA-256 verified before use. Manifests keep cache: 'no-cache'.
 */
import {instantiateWeightEngine} from '../phase4/performance/loader.mjs';

function check(ok, message) { if (!ok) throw new Error(`Handwired weights: ${message}`); }

export function isContentAddressed(manifest) {
  const file = manifest?.binary?.file, digest = manifest?.binary?.sha256;
  const m = typeof file === 'string' && /-([0-9a-f]{12})\.bin$/.exec(file);
  return !!m && typeof digest === 'string' && digest.startsWith(m[1]);
}

export async function fetchWeightEngine(manifestUrl, {fetchImpl = globalThis.fetch, timings = null} = {}) {
  check(typeof fetchImpl === 'function', 'fetch unavailable');
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const t0 = now();
  const url = new URL(manifestUrl, globalThis.location?.href ?? import.meta.url);
  const manifestResponse = await fetchImpl(url.href, {cache: 'no-cache'});
  check(manifestResponse.ok, `manifest request failed (${manifestResponse.status})`);
  const manifest = await manifestResponse.json();
  check(typeof manifest.binary?.file === 'string' && /^[a-zA-Z0-9_.-]+$/.test(manifest.binary.file), 'invalid binary filename');
  const binaryUrl = new URL(manifest.binary.file, url);
  const cache = isContentAddressed(manifest) ? 'default' : 'no-cache';
  const t1 = now();
  const binaryResponse = await fetchImpl(binaryUrl.href, {cache});
  check(binaryResponse.ok, `binary request failed (${binaryResponse.status})`);
  const bytes = await binaryResponse.arrayBuffer();
  const t2 = now();
  const engine = await instantiateWeightEngine(manifest, bytes);
  if (timings) Object.assign(timings, {manifestMs: t1 - t0, binaryMs: t2 - t1, instantiateMs: now() - t2, binaryCache: cache, start: t0, end: now()});
  return engine;
}
