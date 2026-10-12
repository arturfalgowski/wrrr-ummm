// Dźwięk w 100% proceduralny (Web Audio API): silnik zależny od obrotów, poślizg, kolizje, sygnały i interfejs.
let ctx = null, master = null, noiseBuf = null, muted = false;
try { muted = localStorage.getItem('tc_muted') === '1'; } catch { /* brak storage */ }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.7;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}
export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('tc_muted', m ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.7, ctx.currentTime, 0.05);
}

const noiseSrc = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; };

function tone({ type = 'sine', f = 440, f2 = null, dur = 0.15, gain = 0.2, attack = 0.005, when = 0, dest = master }) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
}

/** Silnik + opony + trawa dla jednego auta (lokalnego lub przeciwnika). */
export class CarAudio {
  constructor(volume = 1, pan = 0) {
    this.on = !!ctx;
    if (!ctx) return;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    const panner = ctx.createStereoPanner(); panner.pan.value = pan; this.panner = panner;
    this.out.connect(panner).connect(master);
    this.volume = volume;
    // silnik: dwa piły + kwadrat podbijający harmoniczne, przez lowpass i lekkie przesterowanie
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'sawtooth';
    this.o3 = ctx.createOscillator(); this.o3.type = 'square';
    this.g1 = ctx.createGain(); this.g2 = ctx.createGain(); this.g3 = ctx.createGain();
    this.g1.gain.value = 0.5; this.g2.gain.value = 0.35; this.g3.gain.value = 0.12;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 2.5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    this.eg = ctx.createGain(); this.eg.gain.value = 0;
    this.o1.connect(this.g1).connect(this.lp); this.o2.connect(this.g2).connect(this.lp); this.o3.connect(this.g3).connect(this.lp);
    this.lp.connect(shaper).connect(this.eg).connect(this.out);
    [this.o1, this.o2, this.o3].forEach((o) => o.start());
    // opony: szum przez filtr pasmowy
    this.sn = noiseSrc();
    this.sbp = ctx.createBiquadFilter(); this.sbp.type = 'bandpass'; this.sbp.frequency.value = 1900; this.sbp.Q.value = 3.5;
    this.sg = ctx.createGain(); this.sg.gain.value = 0;
    this.sn.connect(this.sbp).connect(this.sg).connect(this.out); this.sn.start();
    // wysoki „pisk” opon: dwa dostrojone generatory przez filtr pasmowy
    this.so1 = ctx.createOscillator(); this.so1.type = 'sawtooth'; this.so1.frequency.value = 1180;
    this.so2 = ctx.createOscillator(); this.so2.type = 'square'; this.so2.frequency.value = 1730;
    this.sob = ctx.createBiquadFilter(); this.sob.type = 'bandpass'; this.sob.frequency.value = 1500; this.sob.Q.value = 6;
    this.sog = ctx.createGain(); this.sog.gain.value = 0;
    this.so1.connect(this.sob); this.so2.connect(this.sob); this.sob.connect(this.sog).connect(this.out);
    this.so1.start(); this.so2.start();
    // trawa / krawężnik: niski szum
    this.rn = noiseSrc();
    this.rlp = ctx.createBiquadFilter(); this.rlp.type = 'lowpass'; this.rlp.frequency.value = 500;
    this.rg = ctx.createGain(); this.rg.gain.value = 0;
    this.rn.connect(this.rlp).connect(this.rg).connect(this.out); this.rn.start();
    this.rpm = 900; this.gear = 0;
  }

  /** speed: 0..1 względem prędkości maksymalnej, throttle 0..1, slip 0..1, rough 0..1 */
  update({ speed, throttle, slip, rough, active = true }, dt) {
    if (!this.on) return;
    const t = ctx.currentTime;
    const sp = Math.abs(speed);
    // 5 biegów — obroty „piłą”, czuć zmianę biegu
    const gears = 5;
    const g = Math.min(gears - 1, Math.floor(sp * gears * 0.98));
    const within = sp * gears - g;
    const target = 1700 + within * 5200 + throttle * 700;
    const idle = 900 + throttle * 1800;
    const want = sp < 0.03 ? idle : target;
    this.rpm += (want - this.rpm) * Math.min(1, dt * (throttle > 0.1 ? 9 : 5));
    const f = this.rpm / 60 * 2;
    this.o1.frequency.setTargetAtTime(f, t, 0.03);
    this.o2.frequency.setTargetAtTime(f * 1.005 + 0.6, t, 0.03);
    this.o3.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.lp.frequency.setTargetAtTime(380 + this.rpm * 0.22 + throttle * 700, t, 0.05);
    this.eg.gain.setTargetAtTime(active ? 0.22 + throttle * 0.28 : 0, t, 0.06);
    this.out.gain.setTargetAtTime(this.volume, t, 0.1);
    this.sg.gain.setTargetAtTime(Math.min(1, slip) * 0.42, t, 0.04);
    this.sog.gain.setTargetAtTime(Math.min(1, slip) ** 1.3 * 0.16, t, 0.05);
    const wob = 1 + Math.sin(t * 17) * 0.015 * slip;
    this.so1.frequency.setTargetAtTime((1050 + slip * 330 + Math.abs(speed) * 160) * wob, t, 0.05);
    this.so2.frequency.setTargetAtTime((1560 + slip * 420 + Math.abs(speed) * 200) * wob, t, 0.05);
    this.sbp.frequency.setTargetAtTime(1500 + slip * 900, t, 0.05);
    this.rg.gain.setTargetAtTime(Math.min(1, rough) * Math.min(1, sp * 2) * 0.5, t, 0.08);
  }

  stop() {
    if (!this.on) return;
    const t = ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => { [this.o1, this.o2, this.o3, this.sn, this.rn, this.so1, this.so2].forEach((o) => { try { o.stop(); } catch { /* ok */ } }); this.out.disconnect(); }, 400);
  }
}

export const sfx = {
  crash(power = 0.5, pan = 0) {
    if (!ctx) return;
    const p = Math.min(1, power);
    const t = ctx.currentTime;
    const src = noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.7 * p + 0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    const pn = ctx.createStereoPanner(); pn.pan.value = pan;
    src.connect(bp).connect(g).connect(pn).connect(master); src.start(t, Math.random()); src.stop(t + 0.4);
    tone({ type: 'sine', f: 150, f2: 38, dur: 0.3, gain: 0.7 * p + 0.15 });
    tone({ type: 'square', f: 320 + Math.random() * 80, f2: 120, dur: 0.12, gain: 0.08 * p });
  },
  beep(go = false) {
    if (go) { tone({ type: 'square', f: 880, dur: 0.7, gain: 0.22, attack: 0.01 }); tone({ type: 'sawtooth', f: 1320, dur: 0.7, gain: 0.08 }); }
    else tone({ type: 'square', f: 440, dur: 0.22, gain: 0.2, attack: 0.01 });
  },
  lap() { tone({ type: 'triangle', f: 660, dur: 0.12, gain: 0.2 }); tone({ type: 'triangle', f: 990, dur: 0.18, gain: 0.2, when: 0.1 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', f, dur: 0.28, gain: 0.14, when: i * 0.13 })); tone({ type: 'triangle', f: 1047, dur: 0.9, gain: 0.18, when: 0.55 }); },
  lose() { [392, 349, 311, 262].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.32, gain: 0.2, when: i * 0.17 })); },
  click() { tone({ type: 'triangle', f: 520, f2: 760, dur: 0.07, gain: 0.12 }); },
  hover() { tone({ type: 'sine', f: 900, dur: 0.035, gain: 0.04 }); },
  pickup() { tone({ type: 'sine', f: 660, f2: 1320, dur: 0.18, gain: 0.2 }); tone({ type: 'triangle', f: 990, f2: 1980, dur: 0.22, gain: 0.12, when: 0.07 }); },
  land() { tone({ type: 'sine', f: 120, f2: 50, dur: 0.18, gain: 0.25 }); },
  nitro() {
    if (!ctx) return; const t = ctx.currentTime;
    const src = noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.5); bp.frequency.exponentialRampToValueAtTime(1200, t + 2.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.15); g.gain.setValueAtTime(0.3, t + 2.0); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    src.connect(bp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 2.7);
    tone({ type: 'sawtooth', f: 180, f2: 520, dur: 0.6, gain: 0.12 });
  },
  shoot() { tone({ type: 'square', f: 900, f2: 140, dur: 0.22, gain: 0.2 }); tone({ type: 'sawtooth', f: 240, f2: 60, dur: 0.18, gain: 0.18 }); },
  hit() { tone({ type: 'sawtooth', f: 260, f2: 50, dur: 0.4, gain: 0.3 }); this.crash(0.5); },
  oil() { if (!ctx) return; const t = ctx.currentTime; const src = noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; const g = ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); src.connect(lp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 0.4); tone({ type: 'sine', f: 300, f2: 90, dur: 0.25, gain: 0.2 }); },
  tire(power = 0.5) { tone({ type: 'sine', f: 190, f2: 60, dur: 0.22, gain: 0.35 * power + 0.1 }); tone({ type: 'square', f: 140, f2: 70, dur: 0.1, gain: 0.08 }); },
  explode() {
    if (!ctx) return; const t = ctx.currentTime;
    const src = noiseSrc(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    src.connect(lp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 1.4);
    tone({ type: 'sine', f: 110, f2: 28, dur: 0.9, gain: 0.9 });
  },
  empty() { tone({ type: 'square', f: 200, dur: 0.06, gain: 0.08 }); },
  join() { tone({ type: 'sine', f: 600, dur: 0.1, gain: 0.15 }); tone({ type: 'sine', f: 900, dur: 0.16, gain: 0.15, when: 0.09 }); },
};
export const audioReady = () => !!ctx;
