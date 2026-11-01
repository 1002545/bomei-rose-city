/** Project-specific Handwired tensor-bundle v1 loader. No dynamic code or compiler. */
import { createTensorWorkspace, executeTensorProgram } from './tensor-executor.mjs';
const FORMAT = 'bomei2.handwired.tensor-bundle';
const COMMIT = '4ea7fcb27ebe93acf49b9f29a93e162b975bad46';
const TYPES = Object.freeze({ float32: Float32Array, uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array, int32: Int32Array });
const MAX_VALUES = 10_000_000;
function check(ok, message) { if (!ok) throw new Error(`Handwired weights: ${message}`); }
function integer(value, label, maximum = MAX_VALUES) { check(Number.isInteger(value) && value >= 0 && value <= maximum, `invalid ${label}`); return value; }
function indices(values, limit, label) { check(values instanceof Uint8Array || values instanceof Uint16Array || values instanceof Uint32Array, `invalid ${label} type`); for (const n of values) check(n < limit, `${label} index out of range`); }
function finite(values, label) { check(values instanceof Float32Array, `invalid ${label} type`); for (const n of values) check(Number.isFinite(n), `non-finite ${label}`); }
export async function sha256Hex(bytes) {
  check(globalThis.crypto?.subtle, 'SHA-256 integrity verification unavailable (HTTPS required)');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
function unpack(value, buffer, depth = 0) {
  check(depth < 30, 'manifest nesting exceeds limit');
  if (Array.isArray(value)) return value.map(x => unpack(x, buffer, depth + 1));
  if (value && typeof value === 'object') {
    if (value.kind === 'tensor') {
      const Ctor = TYPES[value.dtype]; check(Ctor, 'unknown tensor dtype');
      const offset = integer(value.byteOffset, 'tensor byte offset', buffer.byteLength);
      const length = integer(value.length, 'tensor length');
      check(offset % Ctor.BYTES_PER_ELEMENT === 0 && offset + length * Ctor.BYTES_PER_ELEMENT <= buffer.byteLength, 'tensor outside binary');
      return new Ctor(buffer, offset, length);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unpack(v, buffer, depth + 1)]));
  }
  return value;
}
function validateProgram(program, graph) {
  const p = program;
  integer(p.sourceSize, 'sourceSize'); integer(p.valueCount, 'valueCount'); integer(p.width, 'width'); integer(p.gatherSlotCount, 'gatherSlotCount');
  check(p.sourceSize <= p.valueCount && p.valueCount <= p.width, 'inconsistent program sizes');
  check(Array.isArray(p.layers) && p.layers.length <= MAX_VALUES, 'invalid layers');
  indices(p.roots, p.width, 'roots'); indices(p.wireOrder, p.width, 'wireOrder');
  check(p.wireOrder.length === p.valueCount, 'wireOrder length');
  check(new Set(p.wireOrder).size === p.valueCount, 'duplicate wireOrder entries');
  for (let i = 0; i < p.sourceSize; i++) check(p.wireOrder[i] === i, 'source packing mismatch');
  check(Array.isArray(graph.inputNames) && graph.inputNames.length === p.sourceSize, 'input interface mismatch');
  check(Array.isArray(graph.outputNames) && graph.outputNames.length === p.roots.length, 'output interface mismatch');
  check(Array.isArray(graph.sourceRanges) && graph.sourceRanges.length === p.sourceSize, 'source ranges mismatch');
  check(Array.isArray(graph.sourceBits) && graph.sourceBits.length === p.sourceSize, 'source bit declarations mismatch');
  for (const range of graph.sourceRanges) check(Array.isArray(range) && range.length === 2 && range.every(x => x === null || Number.isFinite(x)) && (range[0] === null || range[1] === null || range[0] <= range[1]), 'invalid source range');
  const rootPositions = Int32Array.from(p.roots, root => p.wireOrder.indexOf(root));
  for (const x of rootPositions) check(x >= 0, 'unmapped root');
  let available = p.sourceSize;
  for (const layer of p.layers) {
    integer(layer.inputSize, 'inputSize'); integer(layer.outputSize, 'outputSize');
    check(layer.inputIndices.length === layer.inputSize, 'inputIndices length');
    indices(layer.inputIndices, available, 'inputIndices'); finite(layer.bias, 'bias'); finite(layer.weights, 'weights');
    indices(layer.gateRows, layer.outputSize, 'gateRows'); indices(layer.booleanRows, layer.outputSize, 'booleanRows');
    indices(layer.columns, layer.inputSize, 'columns');
    check(layer.columns.length === layer.weights.length, 'sparse columns/weights length');
    indices(layer.rowOffsets, layer.weights.length + 1, 'rowOffsets');
    check(layer.rowOffsets.length === layer.bias.length + 1 && layer.rowOffsets[0] === 0 && layer.rowOffsets.at(-1) === layer.weights.length, 'sparse row offsets');
    for (let i = 1; i < layer.rowOffsets.length; i++) check(layer.rowOffsets[i] >= layer.rowOffsets[i - 1], 'non-monotonic sparse rows');
    check(layer.bias.length >= layer.outputSize + layer.gateRows.length, 'projection too short');
    check(Array.isArray(layer.gatherComputes) && Array.isArray(layer.gatherReads) && Array.isArray(layer.indexReads), 'missing read topology');
    for (const c of layer.gatherComputes) { integer(c.slot, 'gather slot', p.gatherSlotCount - 1); indices(c.bitPositions, available, 'gather bits'); }
    for (const r of layer.gatherReads) { integer(r.row, 'gather row', layer.outputSize - 1); integer(r.slot, 'gather slot', p.gatherSlotCount - 1); indices(r.candidatePositions, available, 'gather candidates'); check(r.candidatePositions.length > 0 && typeof r.masked === 'boolean', 'invalid gather read'); }
    for (const r of layer.indexReads) {
      integer(r.row, 'index row', layer.outputSize - 1); integer(r.indexRow, 'index projection', layer.bias.length - 1); integer(r.candidateCount, 'candidateCount'); check(r.candidateCount > 0, 'empty index table');
      indices(r.candidatePositions, available, 'index candidates');
      check(typeof r.belowZero === 'boolean' && typeof r.aboveZero === 'boolean', 'invalid index boundary rules');
      if (r.candidatePositions.length) check(r.candidatePositions.length === r.candidateCount, 'index table length');
      else { integer(r.candidateBase, 'candidateBase', available - 1); check(Number.isInteger(r.candidateStride), 'invalid candidate stride'); const last = r.candidateBase + (r.candidateCount - 1) * r.candidateStride; check(last >= 0 && last < available, 'index table stride out of bounds'); }
    }
    available += layer.outputSize;
  }
  check(available === p.valueCount, 'packed value count mismatch');
  return rootPositions;
}
export async function instantiateWeightEngine(manifest, inputBuffer) {
  check(manifest?.format === FORMAT && manifest.version === 1, 'unsupported schema or version');
  check(manifest.upstream?.commit === COMMIT, 'unexpected upstream commit');
  check(manifest.numericSemantics?.dtype === 'float32' && manifest.numericSemantics.byteOrder === 'little-endian', 'unsupported numeric semantics');
  check(new Uint8Array(new Uint16Array([1]).buffer)[0] === 1, 'big-endian host unsupported');
  const buffer = inputBuffer instanceof ArrayBuffer ? inputBuffer : inputBuffer.buffer.slice(inputBuffer.byteOffset, inputBuffer.byteOffset + inputBuffer.byteLength);
  check(buffer.byteLength === manifest.binary?.byteLength, 'binary size mismatch');
  check(/^[0-9a-f]{64}$/.test(manifest.binary.sha256), 'invalid binary SHA-256');
  const digest = await sha256Hex(buffer); check(digest === manifest.binary.sha256, 'binary SHA-256 mismatch');
  check(Array.isArray(manifest.graphs) && manifest.graphs.length > 0 && manifest.graphs.length <= 1000, 'invalid graph collection');
  check(/^[0-9a-f]{64}$/.test(manifest.topologySha256), 'invalid topology SHA-256');
  const topologyDigest = await sha256Hex(new TextEncoder().encode(JSON.stringify(manifest.graphs)));
  check(topologyDigest === manifest.topologySha256, 'topology SHA-256 mismatch');
  const programs = new Map(); const calls = Object.create(null);
  for (const graph of manifest.graphs) {
    check(typeof graph.name === 'string' && !programs.has(graph.name), 'duplicate/invalid graph name');
    const program = unpack(graph.program, buffer); const rootPositions = validateProgram(program, graph);
    programs.set(graph.name, { graph, program, rootPositions, workspace: createTensorWorkspace(program), outputs: new Float32Array(program.roots.length) });
    calls[graph.name] = 0;
  }
  let callCount = 0;
  const engine = {
    manifest, verifiedSha256: digest, graphNames: [...programs.keys()], counts: manifest.graphs.map(g => ({ name: g.name, ...g.counts })),
    get callCount() { return callCount; }, get calls() { return { ...calls }; },
    evaluate(name, source) {
      const entry = programs.get(name);
      if (!entry) check(false, `unknown graph ${String(name)}`);
      const { graph, program, workspace, outputs, rootPositions } = entry;
      if (!(source instanceof Float32Array && source.length === program.sourceSize)) check(false, `${name}: expected Float32Array(${program.sourceSize})`);
      for (let i = 0; i < source.length; i++) {
        const x = source[i]; const range = graph.sourceRanges[i];
        if (!Number.isFinite(x) || (range[0] !== null && x < range[0]) || (range[1] !== null && x > range[1])) throw new Error(`Handwired weights: ${name} input ${graph.inputNames[i]}=${x} outside ${range[0]}..${range[1]}`);
        if (graph.sourceBits[i] && x !== 0 && x !== 1) throw new Error(`Handwired weights: ${name} input ${graph.inputNames[i]} must be 0 or 1`);
      }
      executeTensorProgram(source, program, workspace);
      for (let i = 0; i < outputs.length; i++) {
        const x = workspace.packedValues[rootPositions[i]];
        if (!Number.isFinite(x)) throw new Error(`Handwired weights: ${name} output ${graph.outputNames[i]} is non-finite`);
        outputs[i] = x;
      }
      callCount++; calls[name]++;
      return outputs;
    },
    inspectGraph(name) {
      const entry = programs.get(name); check(entry, `unknown graph ${String(name)}`);
      return { name, inputNames: [...entry.graph.inputNames], outputNames: [...entry.graph.outputNames], counts: { ...entry.graph.counts }, state: entry.graph.state };
    }
  };
  return engine;
}
export async function loadWeightEngine(manifestUrl, { fetchImpl = globalThis.fetch } = {}) {
  check(typeof fetchImpl === 'function', 'fetch unavailable');
  const url = new URL(manifestUrl, globalThis.location?.href ?? import.meta.url);
  const manifestResponse = await fetchImpl(url.href, { cache: 'no-cache' });
  check(manifestResponse.ok, `manifest request failed (${manifestResponse.status})`);
  const manifest = await manifestResponse.json();
  check(typeof manifest.binary?.file === 'string' && /^[a-zA-Z0-9_.-]+$/.test(manifest.binary.file), 'invalid binary filename');
  const binaryUrl = new URL(manifest.binary.file, url);
  const binaryResponse = await fetchImpl(binaryUrl.href, { cache: 'no-cache' });
  check(binaryResponse.ok, `binary request failed (${binaryResponse.status})`);
  return instantiateWeightEngine(manifest, await binaryResponse.arrayBuffer());
}
