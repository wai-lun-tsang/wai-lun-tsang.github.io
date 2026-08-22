/* DocketMaster — Time & Timer logic
   Binge = plain countdown (or count-up if no estimate). Pomodoro = alternating
   work/break phases at a configurable ratio (default 50/10). Default mode
   auto-syncs to whatever task is currently scheduled "now"; manual override
   available at any time without changing the task's saved Type.
*/

function beep(freq = 880, durationMs = 350) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000 + 0.05);
  } catch { /* AudioContext unavailable — fail silently */ }
}

function vibrateIfSupported(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* no-op */ }
  }
}

class DocketTimer {
  constructor() {
    this.mode = null;       // "binge" | "pomodoro"
    this.phase = "work";    // "work" | "break" (pomodoro only)
    this.remainingSec = 0;
    this.running = false;
    this.linkedTaskId = null;
    this.isAuto = false;
    this.ratio = { workMin: 50, breakMin: 10 };
    this._intervalId = null;
    this._listeners = {};
    this.alerts = { sound: true, visual: true, vibrate: true };
  }

  on(event, cb) {
    (this._listeners[event] ||= []).push(cb);
  }
  _emit(event, payload) {
    (this._listeners[event] || []).forEach(cb => cb(payload));
  }

  configure(alerts) {
    this.alerts = { ...this.alerts, ...alerts };
  }

  startBinge(minutes, taskId = null, isAuto = false) {
    this._stopInterval();
    this.mode = "binge";
    this.phase = "work";
    this.remainingSec = Math.max(0, Math.round(minutes * 60));
    this.linkedTaskId = taskId;
    this.isAuto = isAuto;
    this.running = true;
    this._startInterval();
    this._emit("change", this.snapshot());
  }

  startPomodoro(ratio, taskId = null, isAuto = false) {
    this._stopInterval();
    this.mode = "pomodoro";
    this.phase = "work";
    this.ratio = ratio || this.ratio;
    this.remainingSec = this.ratio.workMin * 60;
    this.linkedTaskId = taskId;
    this.isAuto = isAuto;
    this.running = true;
    this._startInterval();
    this._emit("change", this.snapshot());
  }

  pause() {
    this.running = false;
    this._stopInterval();
    this._emit("change", this.snapshot());
  }

  resume() {
    if (!this.mode) return;
    this.running = true;
    this._startInterval();
    this._emit("change", this.snapshot());
  }

  reset() {
    this._stopInterval();
    this.mode = null;
    this.phase = "work";
    this.remainingSec = 0;
    this.running = false;
    this.linkedTaskId = null;
    this.isAuto = false;
    this._emit("change", this.snapshot());
  }

  _startInterval() {
    this._intervalId = setInterval(() => this._tick(), 1000);
  }
  _stopInterval() {
    if (this._intervalId) clearInterval(this._intervalId);
    this._intervalId = null;
  }

  _tick() {
    if (!this.running) return;
    this.remainingSec -= 1;
    if (this.remainingSec <= 0) {
      this._onRing();
      if (this.mode === "pomodoro") {
        this.phase = this.phase === "work" ? "break" : "work";
        const mins = this.phase === "work" ? this.ratio.workMin : this.ratio.breakMin;
        this.remainingSec = mins * 60;
      } else {
        this.running = false;
        this._stopInterval();
      }
    }
    this._emit("change", this.snapshot());
  }

  _onRing() {
    if (this.alerts.sound) {
      beep(this.phase === "break" ? 660 : 880);
      if (this.mode === "pomodoro") setTimeout(() => beep(this.phase === "break" ? 660 : 880), 400);
    }
    if (this.alerts.vibrate) vibrateIfSupported([200, 100, 200]);
    this._emit("ring", this.snapshot());
  }

  snapshot() {
    return {
      mode: this.mode, phase: this.phase, remainingSec: this.remainingSec,
      running: this.running, linkedTaskId: this.linkedTaskId, isAuto: this.isAuto,
      ratio: this.ratio, alerts: this.alerts,
    };
  }
}

function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function currentTimeInZone(tz) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
  } catch {
    return new Date().toLocaleTimeString();
  }
}

/** Finds a task scheduled for today whose timeSlot covers the current moment, if any. */
async function findCurrentScheduledTask(tz) {
  const today = docketTodayStr(tz);
  const tasks = await Tasks.getTasksForDate(today);
  const nowHM = currentTimeInZone(tz).slice(0, 5);
  return tasks.find(t => {
    if (t.status === "completed" || !t.timeSlot) return false;
    return t.timeSlot.start <= nowHM && nowHM <= t.timeSlot.end;
  }) || null;
}

window.DocketTimer = DocketTimer;
window.formatClock = formatClock;
window.currentTimeInZone = currentTimeInZone;
window.findCurrentScheduledTask = findCurrentScheduledTask;
