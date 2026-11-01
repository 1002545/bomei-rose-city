/** R63 wallet debit adapter. Amounts are integer cents (Number.isSafeInteger). No silent fallback:
 * every native path (diagnostic mode or out-of-domain) is counted in snapshot().
 * debit(cashCents, totalCents) -> {ok, cash}: ok=false means insufficient funds (cash = unchanged balance);
 * ok=true means cash = cashCents - totalCents exactly. */
const MAX_HKD = 16777215, LIMIT = (MAX_HKD + 1) * 100;
export function nativeDebit(cash, total) {
  return cash >= total ? {ok: true, cash: cash - total} : {ok: false, cash};
}
export function createWalletLogic(engine, {mode = 'weights'} = {}) {
  if (mode !== 'weights' && mode !== 'native') throw Error('R63 wallet invalid mode ' + mode);
  if (mode === 'weights' && typeof engine?.evaluate !== 'function') throw Error('R63 wallet weight engine required');
  const input = new Float32Array(4);
  const stats = {mode, calls: 0, graphCalls: 0, native: 0, outOfDomain: 0, insufficient: 0, errors: 0};
  return {
    debit(cash, total) {
      stats.calls++;
      if (!Number.isSafeInteger(cash) || !Number.isSafeInteger(total) || cash < 0 || total < 0) {
        // Explicit, counted: the caller already rejects non-integer/negative totals; unsafe balance is "insufficient".
        stats.native++; stats.outOfDomain++;
        const r = Number.isSafeInteger(cash) && Number.isSafeInteger(total) ? nativeDebit(cash, total) : {ok: false, cash};
        if (!r.ok) stats.insufficient++;
        return r;
      }
      if (mode === 'native' || cash >= LIMIT || total >= LIMIT) {
        stats.native++; if (mode !== 'native') stats.outOfDomain++;
        const r = nativeDebit(cash, total);
        if (!r.ok) stats.insufficient++;
        return r;
      }
      input[0] = (cash - cash % 100) / 100; input[1] = cash % 100;
      input[2] = (total - total % 100) / 100; input[3] = total % 100;
      let out;
      try { out = engine.evaluate('wallet63_debit', input); }
      catch (error) { stats.errors++; throw error; }
      stats.graphCalls++;
      const ok = out[0], hkd = out[1], cents = out[2];
      if (out.length !== 3 || (ok !== 0 && ok !== 1) || !Number.isInteger(hkd) || !Number.isInteger(cents) || cents < 0 || cents > 99 || (ok === 1 && hkd < 0)) {
        stats.errors++; throw Error('R63 malformed wallet graph output');
      }
      if (ok === 0) { stats.insufficient++; return {ok: false, cash}; }
      return {ok: true, cash: hkd * 100 + cents};
    },
    snapshot: () => ({...stats}),
  };
}
