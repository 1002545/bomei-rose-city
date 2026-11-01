/* Derived from Handwired, MIT, Copyright (c) 2026 Cheng Lou.
 * Upstream commit: 4ea7fcb27ebe93acf49b9f29a93e162b975bad46
 * Generic preplanned executor. No dynamic JavaScript generation, model-specific
 * formulas, coefficient folding, arithmetic reassociation, or result cache.
 * See README.md for the memory-alias and FP32 equivalence argument.
 */
function createTensorWorkspace(program) {
  let available = program.sourceSize;
  let capacity = program.valueCount;
  for (const layer of program.layers) {
    capacity = Math.max(capacity, available + layer.bias.length);
    available += layer.outputSize;
  }
  const packedValues = new Float32Array(capacity);
  available = program.sourceSize;
  const plans = program.layers.map(layer => {
    // Input gathering copies an already-FP32 value. Resolving its position once
    // removes the copy without eliminating any numerical rounding operation.
    const sourcePositions = Uint32Array.from(layer.columns, column => layer.inputIndices[column]);
    // Extra projection rows occupy only unproduced future slots. No layer can
    // read these via packedValues until the corresponding value is produced.
    const projection = packedValues.subarray(available, available + layer.bias.length);
    available += layer.outputSize;
    return { layer, sourcePositions, projection };
  });
  return {
    packedValues,
    plans,
    tape: createTape(program),
    gatherIndices: new Int32Array(program.gatherSlotCount),
    gatherMasses: new Float32Array(program.gatherSlotCount),
  };
}
// Programs without gather/index side tables admit one generic affine/gate/
// boolean tape. The tape contains topology only, never coefficient values.
// If coefficients do not share a single backing buffer, use the planned path.
function createTape(program) {
  if (!program.layers.length) return null;
  const buffer = program.layers[0].weights.buffer;
  if (buffer.byteLength % 4 || program.layers.some(l => l.gatherReads.length || l.indexReads.length || l.weights.buffer !== buffer || l.bias.buffer !== buffer)) return null;
  const words = [];
  let available = program.sourceSize;
  for (const layer of program.layers) {
    for (let row = 0; row < layer.bias.length; row++) {
      const first = layer.rowOffsets[row], end = layer.rowOffsets[row + 1], count = end - first;
      let rows = 1;
      if (count < 4) while (row + rows < layer.bias.length && layer.rowOffsets[row + rows + 1] - layer.rowOffsets[row + rows] === count) rows++;
      if (rows > 1) {
        words.push(7 + count, available + row, layer.bias.byteOffset / 4 + row, rows);
        for (let k = first; k < layer.rowOffsets[row + rows]; k++) words.push(layer.weights.byteOffset / 4 + k, layer.inputIndices[layer.columns[k]]);
        row += rows - 1;
        continue;
      }
      words.push(Math.min(count, 4), available + row, layer.bias.byteOffset / 4 + row);
      if (count >= 4) words.push(count);
      for (let k = first; k < end; k++) words.push(layer.weights.byteOffset / 4 + k, layer.inputIndices[layer.columns[k]]);
    }
    for (let row = 0; row < layer.gateRows.length; row++) words.push(5, available + layer.gateRows[row], available + layer.outputSize + row);
    for (const row of layer.booleanRows) words.push(6, available + row);
    available += layer.outputSize;
  }
  return {words: Uint32Array.from(words), coefficients: new Float32Array(buffer)};
}
function executeTape(values, tape) {
  const {words, coefficients} = tape;
  let pc = 0;
  while (pc < words.length) {
    const op = words[pc++];let out = words[pc++];
    let value, count, bias;
    switch (op) {
      case 0: values[out] = coefficients[words[pc++]]; break;
      case 1:
        value = coefficients[words[pc++]];
        values[out] = Math.fround(value + Math.fround(coefficients[words[pc++]] * values[words[pc++]])); break;
      case 2:
        value = coefficients[words[pc++]];
        value = Math.fround(value + Math.fround(coefficients[words[pc++]] * values[words[pc++]]));
        values[out] = Math.fround(value + Math.fround(coefficients[words[pc++]] * values[words[pc++]])); break;
      case 3:
        value = coefficients[words[pc++]];
        value = Math.fround(value + Math.fround(coefficients[words[pc++]] * values[words[pc++]]));
        value = Math.fround(value + Math.fround(coefficients[words[pc++]] * values[words[pc++]]));
        values[out] = Math.fround(value + Math.fround(coefficients[words[pc++]] * values[words[pc++]])); break;
      case 4:
        value = coefficients[words[pc++]]; count = words[pc++];
        for (let i = 0; i < count; i++) value = Math.fround(value + Math.fround(coefficients[words[pc++]] * values[words[pc++]]));
        values[out] = value; break;
      case 5: values[out] = Math.fround(values[out] * Math.max(0, values[words[pc++]])); break;
      case 6: values[out] = Math.fround(Math.fround(Math.fround(values[out]) + 8_388_609) - 8_388_609); break;
      case 7:
        bias=words[pc++];count=words[pc++];
        for(let i=0;i<count;i++)values[out++]=coefficients[bias++];break;
      case 8:
        bias=words[pc++];count=words[pc++];
        for(let i=0;i<count;i++)values[out++]=Math.fround(coefficients[bias++]+Math.fround(coefficients[words[pc++]]*values[words[pc++]]));break;
      case 9:
        bias=words[pc++];count=words[pc++];
        for(let i=0;i<count;i++){
          value=Math.fround(coefficients[bias++]+Math.fround(coefficients[words[pc++]]*values[words[pc++]]));
          values[out++]=Math.fround(value+Math.fround(coefficients[words[pc++]]*values[words[pc++]]));
        }break;
      case 10:
        bias=words[pc++];count=words[pc++];
        for(let i=0;i<count;i++){
          value=Math.fround(coefficients[bias++]+Math.fround(coefficients[words[pc++]]*values[words[pc++]]));
          value=Math.fround(value+Math.fround(coefficients[words[pc++]]*values[words[pc++]]));
          values[out++]=Math.fround(value+Math.fround(coefficients[words[pc++]]*values[words[pc++]]));
        }break;
    }
  }
}
function executeTensorProgram(source, program, workspace) {
  if (source.length !== program.sourceSize) throw new Error('source table has the wrong length');
  const { packedValues, plans, gatherIndices, gatherMasses } = workspace;
  packedValues.set(source);
  if (workspace.tape) { executeTape(packedValues, workspace.tape); return; }
  for (const plan of plans) {
    const { layer, sourcePositions, projection } = plan;
    sparsePackedMatmulAddBias(projection, layer.weights, sourcePositions, layer.rowOffsets, packedValues, layer.bias);
    if (layer.gatherReads.length > 0) applyGathers(layer, packedValues, projection, gatherIndices, gatherMasses);
    if (layer.indexReads.length > 0) applyIndexReads(layer, packedValues, projection);
    for (let gateRow = 0; gateRow < layer.gateRows.length; gateRow++) {
      const outputRow = layer.gateRows[gateRow];
      projection[outputRow] = Math.fround(projection[outputRow] * Math.max(0, projection[layer.outputSize + gateRow]));
    }
    for (let booleanIndex = 0; booleanIndex < layer.booleanRows.length; booleanIndex++) {
      const booleanRow = layer.booleanRows[booleanIndex];
      const score = Math.fround(projection[booleanRow]);
      const shifted = Math.fround(score + 8_388_609);
      projection[booleanRow] = Math.fround(shifted - 8_388_609);
    }
  }
}
function sparsePackedMatmulAddBias(output, weights, sourcePositions, rowOffsets, packedValues, bias) {
  for (let row = 0; row < bias.length; row++) {
    let value = bias[row];
    const first = rowOffsets[row], end = rowOffsets[row + 1];
    // Structural short-row kernels preserve ascending coefficient order and
    // both fround boundaries. Coefficients are fetched afresh on every call.
    switch (end - first) {
      case 0: break;
      case 1:
        value = Math.fround(value + Math.fround(weights[first] * packedValues[sourcePositions[first]]));
        break;
      case 2:
        value = Math.fround(value + Math.fround(weights[first] * packedValues[sourcePositions[first]]));
        value = Math.fround(value + Math.fround(weights[first + 1] * packedValues[sourcePositions[first + 1]]));
        break;
      case 3:
        value = Math.fround(value + Math.fround(weights[first] * packedValues[sourcePositions[first]]));
        value = Math.fround(value + Math.fround(weights[first + 1] * packedValues[sourcePositions[first + 1]]));
        value = Math.fround(value + Math.fround(weights[first + 2] * packedValues[sourcePositions[first + 2]]));
        break;
      default:
        for (let index = first; index < end; index++) {
          const product = Math.fround(weights[index] * packedValues[sourcePositions[index]]);
          value = Math.fround(value + product);
        }
    }
    output[row] = value;
  }
}
function applyGathers(layer, packedValues, projection, gatherIndices, gatherMasses) {
  for (const compute of layer.gatherComputes) {
    let index = 0, mass = 0;
    for (let position = 0; position < compute.bitPositions.length; position++) {
      const bit = packedValues[compute.bitPositions[position]];
      index += position * bit; mass += bit;
    }
    gatherIndices[compute.slot] = index; gatherMasses[compute.slot] = mass;
  }
  for (const read of layer.gatherReads) {
    const limit = read.candidatePositions.length - 1;
    const index = Math.min(Math.max(gatherIndices[read.slot], 0), limit);
    let contribution = packedValues[read.candidatePositions[index]];
    if (read.masked) contribution = Math.fround(gatherMasses[read.slot] * contribution);
    projection[read.row] = Math.fround(projection[read.row] + contribution);
  }
}
function applyIndexReads(layer, packedValues, projection) {
  for (const read of layer.indexReads) {
    const position = resolveIndexPosition(projection[read.indexRow], read.candidateCount, read.belowZero, read.aboveZero);
    if (position >= 0) projection[read.row] = packedValues[read.candidatePositions.length === 0 ? read.candidateBase + position * read.candidateStride : read.candidatePositions[position]];
    else projection[read.row] = position === -1 ? 0 : Number.NaN;
  }
}
function resolveIndexPosition(index, count, belowZero, aboveZero) {
  if (Number.isNaN(index)) return -2;
  const position = Math.floor(index);
  if (position < 0) return belowZero ? -1 : 0;
  if (position > count - 1) return aboveZero ? -1 : count - 1;
  return position;
}
export { createTensorWorkspace, executeTensorProgram };
