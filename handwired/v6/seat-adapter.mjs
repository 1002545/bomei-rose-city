/** Allocation-stable seat transition adapter. No compiler and no silent fallback.
 *
 * The caller owns one output record for each live seat transition. Inputs are
 * scratch buffers indexed by synchronous call depth. The evaluator's reused
 * output never escapes this adapter. FP64 progress stays in the original game.
 */
const clamp = p => Math.max(0, Math.min(1, p));
const smooth = p => { p = clamp(p); return p * p * (3 - 2 * p); };
function nativeResult(progress, enter, lying, leaveSit, target) {
  target.complete = progress === 1;
  target.rotation = enter ? clamp(progress / (lying ? .78 : .22)) : clamp((progress - .78) / .22);
  target.seatPose = enter ? smooth((progress - .22) / .5) : leaveSit * (1 - smooth((progress - .65) / .35));
  return target;
}

export function createNpcSeatLogic(engine, {mode = 'weights'} = {}) {
  if (mode !== 'weights' && mode !== 'native') throw Error('NPC6 invalid mode ' + mode);
  if (mode === 'weights' && typeof engine?.evaluate !== 'function') throw Error('NPC6 weight engine required');
  const inputs = [new Float32Array(4)];
  let depth = 0;
  const stats = {
    mode, calls: 0, graphCalls: 0, consumed: 0, consumedCompletions: 0,
    native: 0, boundaryRepairs: 0, outOfDomain: 0, errors: 0,
    inputBufferAllocations: 1,
  };
  return {
    npcSeatTransition6(progress, enter, lying, leaveSit, target) {
      stats.calls++;
      if (!target || typeof target !== 'object') throw Error('NPC6 caller-owned output record required');
      if (mode === 'native') {
        stats.native++;
        return nativeResult(progress, enter, lying, leaveSit, target);
      }
      // Preserve legacy exceptional-domain arithmetic explicitly, not as an
      // inference-error catch. Runtime instrumentation makes every case visible.
      if (!Number.isFinite(progress) || progress < 0 || progress > 1 ||
          !Number.isFinite(leaveSit) || leaveSit < -16 || leaveSit > 16) {
        stats.native++; stats.outOfDomain++;
        return nativeResult(progress, enter, lying, leaveSit, target);
      }
      const activeDepth = depth++;
      try {
        let input = inputs[activeDepth];
        if (!input) { input = inputs[activeDepth] = new Float32Array(4); stats.inputBufferAllocations++; }
        input[0] = progress; input[1] = +!!enter; input[2] = +!!lying; input[3] = leaveSit;
        const output = engine.evaluate('npc6_seat_transition', input);
        stats.graphCalls++;
        if (!output || output.length !== 3 || (output[0] !== 0 && output[0] !== 1) ||
            !Number.isFinite(output[1]) || output[1] < -1e-6 || output[1] > 1.000001 ||
            !Number.isFinite(output[2]) || output[2] < -16.00001 || output[2] > 16.00001) {
          throw Error('NPC6 malformed seat graph output');
        }
        // Math.fround can round a Number just below 1 to exactly 1. Repair only
        // that completion bit; both continuous graph outputs remain consumed.
        if (progress < 1 && progress > 1 - 1e-6) {
          target.complete = false;
          stats.boundaryRepairs++;
        } else {
          target.complete = output[0] === 1;
          stats.consumedCompletions++;
        }
        target.rotation = output[1];
        target.seatPose = output[2];
        stats.consumed++;
        return target;
      } catch (error) {
        stats.errors++;
        throw error;
      } finally {
        depth = activeDepth;
      }
    },
    snapshot: () => ({...stats}),
  };
}
