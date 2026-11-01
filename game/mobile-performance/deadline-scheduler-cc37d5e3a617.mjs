/**
 * Deadline-assisted scheduling, independent of the simulation's cadence gate.
 *
 * This does not lower the game frame rate, skip simulation steps, change delta,
 * or touch neural inference. `frame` must retain its existing cadence gate.
 * A timer may sleep through the unneeded part of a frame interval, but actual
 * visible frames always execute in requestAnimationFrame.
 *
 * Input integration: call wakeSoon() when the app is in its idle tier and a real
 * input arrives. The frame callback must recompute the active tier before its
 * cadence gate. Lifecycle/map/modal changes should retain wake()+gate.reset().
 */
export class DeadlineScheduler {
  constructor(frame, {
    hidden = () => false,
    covered = () => false,
    deadline = () => null,
    paced = () => true,
    now = () => performance.now(),
    raf = callback => requestAnimationFrame(callback),
    cancel = handle => cancelAnimationFrame(handle),
    timer = (callback, delay) => setTimeout(callback, delay),
    clear = handle => clearTimeout(handle),
    onError = null,
    leadMs = 4,
    minimumSleepMs = 8,
  } = {}) {
    Object.assign(this, {
      frame, hidden, covered, deadline, paced, now, raf, cancel, timer, clear,
      onError, leadMs, minimumSleepMs,
    });
    this.pending = null;
    this.kind = null;
    this.running = false;
    this.generation = 0;
    this.pacingHoldUntil = 0;
  }

  cancelPending() {
    ++this.generation;
    if (this.pending !== null) {
      (this.kind === 'raf' ? this.cancel : this.clear)(this.pending);
    }
    this.pending = null;
    this.kind = null;
  }

  enqueue(kind, delay = 0) {
    if (this.pending !== null || !this.running || this.hidden()) return;
    const generation = ++this.generation;
    const requestedAt = this.now();
    this.kind = kind;
    const callback = () => {
      // A canceled callback delivered late cannot consume a newer request.
      if (generation !== this.generation) return;
      this.pending = null;
      this.kind = null;
      if (!this.running || this.hidden()) return;
      // Low-refresh/battery-saver RAF should not gain an extra timer per frame.
      // This is a conservative scheduling observation, not a refresh-rate or
      // thermal measurement. A long RAF wait suspends pacing for one second.
      if (kind === 'raf' && this.now() - requestedAt > 20) {
        this.pacingHoldUntil = this.now() + 1000;
      }
      if (kind === 'pace') {
        if (this.covered()) this.schedule();
        else this.enqueue('raf');
        return;
      }
      try {
        this.frame();
      } catch (error) {
        this.stop();
        if (this.onError) {
          this.onError(error);
          return;
        }
        throw error;
      }
      this.schedule();
    };
    this.pending = kind === 'raf'
      ? this.raf(callback)
      : this.timer(callback, delay);
  }

  schedule() {
    if (!this.running || this.hidden() || this.pending !== null) return;
    if (this.covered()) {
      this.enqueue('covered', 1000);
      return;
    }
    const next = this.deadline();
    const wait = typeof next === 'number' && Number.isFinite(next)
      ? next - this.now() - this.leadMs
      : 0;
    if (this.paced() && this.now() >= this.pacingHoldUntil &&
        wait >= this.minimumSleepMs) {
      this.enqueue('pace', wait);
    } else {
      this.enqueue('raf');
    }
  }

  stop() {
    this.cancelPending();
    this.running = false;
  }

  wake() {
    this.stop();
    this.running = true;
    // Lifecycle wake must not inherit a stale deadline.
    if (this.covered()) this.schedule();
    else this.enqueue('raf');
  }

  wakeSoon() {
    if (!this.running || this.hidden() || this.covered()) return;
    if (this.kind !== 'pace') return;
    this.cancelPending();
    this.enqueue('raf');
  }
}
