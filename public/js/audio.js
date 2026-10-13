// Dźwięk w 100% proceduralny (Web Audio API): silnik zależny od obrotów, poślizg, kolizje, sygnały i interfejs.
let ctx = null, master = null, noiseBuf = null, muted = false, sfxVol = 1;
try { const v = parseFloat(localStorage.getItem('tc_sfx')); if (Number.isFinite(v)) sfxVol = Math.min(1, Math.max(0, v)); } catch { /* brak storage */ }
try { muted = localStorage.getItem('tc_muted') === '1'; } catch { /* brak storage */ }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.7 * sfxVol;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}
export function isMuted() { return muted; }
export const getSfxVolume = () => sfxVol;
export function setSfxVolume(v) {
  sfxVol = Math.min(1, Math.max(0, v));
  try { localStorage.setItem('tc_sfx', String(sfxVol)); } catch { /* ignore */ }
  if (master && !muted) master.gain.setTargetAtTime(0.7 * sfxVol, ctx.currentTime, 0.03);
}
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('tc_muted', m ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.7 * sfxVol, ctx.currentTime, 0.05);
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

/** widmo spalin: harmoniczne z wyraźnymi parzystymi (jak sportowy silnik wolnossący), cache wspólny dla aut */
let engineWave = null;
function getEngineWave() {
  if (engineWave) return engineWave;
  const N = 28, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) im[n] = (1 / n ** 0.85) * (n % 2 === 0 ? 1.3 : 1) * (n === 3 ? 0.8 : 1) * (n > 14 ? 0.5 : 1);
  engineWave = ctx.createPeriodicWave(re, im); return engineWave;
}
/** przełożenia skrzyni (górna prędkość biegu w ułamku prędkości maks.) i obroty */
const GEAR_TOP = [0.16, 0.30, 0.45, 0.60, 0.75, 0.90, 1.05, 1.38];
const RPM_IDLE = 3600, RPM_MAX = 12600;

/** Silnik (skrzynia 8-biegowa, obroty zależne od prędkości, zmiany biegów, strzały, turbo), opony (pisk, hamowanie), wiatr i trawa dla jednego auta. */
export class CarAudio {
  constructor(volume = 1, pan = 0) {
    this.on = !!ctx;
    if (!ctx) return;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    const panner = ctx.createStereoPanner(); panner.pan.value = pan; this.panner = panner;
    this.out.connect(panner).connect(master);
    this.volume = volume;
    // silnik: dwa generatory ze wspólnym widmem (lekko rozstrojone = „grubość”), podstawa o połowę niżej i warkot szumowy ssania
    const w = getEngineWave();
    const mk = (type) => { const o = ctx.createOscillator(); if (type) o.type = type; else o.setPeriodicWave(w); return o; };
    this.o1 = mk(); this.o2 = mk(); this.o3 = mk('square'); this.o4 = mk('triangle');
    this.g1 = ctx.createGain(); this.g2 = ctx.createGain(); this.g3 = ctx.createGain(); this.g4 = ctx.createGain();
    this.g1.gain.value = 0.55; this.g2.gain.value = 0.4; this.g3.gain.value = 0.07; this.g4.gain.value = 0.3;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 1.4;
    this.pk = ctx.createBiquadFilter(); this.pk.type = 'peaking'; this.pk.Q.value = 2.2; this.pk.gain.value = 7; // formant rezonansu rury wydechowej
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = (i / 256) - 1; curve[i] = Math.tanh(x * 1.9) * 0.92 + 0.08 * x; }
    shaper.curve = curve;
    this.tg = ctx.createGain(); this.tg.gain.value = 1; // tremolo „burble” na wolnym gazie
    this.eg = ctx.createGain(); this.eg.gain.value = 0;
    this.o1.connect(this.g1).connect(this.lp); this.o2.connect(this.g2).connect(this.lp); this.o3.connect(this.g3).connect(this.lp); this.o4.connect(this.g4).connect(this.lp);
    this.lp.connect(this.pk).connect(shaper).connect(this.tg).connect(this.eg).connect(this.out);
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 23; this.lfoG = ctx.createGain(); this.lfoG.gain.value = 0; this.lfo.connect(this.lfoG).connect(this.tg.gain);
    [this.o1, this.o2, this.o3, this.o4, this.lfo].forEach((o) => o.start());
    // ssanie / turbulencja wydechu
    this.in = noiseSrc(); this.ibp = ctx.createBiquadFilter(); this.ibp.type = 'bandpass'; this.ibp.Q.value = 0.9; this.ig = ctx.createGain(); this.ig.gain.value = 0;
    this.in.connect(this.ibp).connect(this.ig).connect(this.out); this.in.start();
    // świst turbosprężarki
    this.to = ctx.createOscillator(); this.to.type = 'sine'; this.tog = ctx.createGain(); this.tog.gain.value = 0;
    this.to.connect(this.tog).connect(this.out); this.to.start();
    // wiatr
    this.wn = noiseSrc(); this.wbp = ctx.createBiquadFilter(); this.wbp.type = 'bandpass'; this.wbp.Q.value = 0.5; this.wg = ctx.createGain(); this.wg.gain.value = 0;
    this.wn.connect(this.wbp).connect(this.wg).connect(this.out); this.wn.start();
    // opony: szum poślizgu (szeroki) + wąski, wysoki „pisk” z drżeniem (stick-slip) + osobny pisk blokującego się hamowania
    this.sn = noiseSrc();
    this.sbp = ctx.createBiquadFilter(); this.sbp.type = 'bandpass'; this.sbp.frequency.value = 1900; this.sbp.Q.value = 3.5;
    this.sg = ctx.createGain(); this.sg.gain.value = 0;
    this.sn.connect(this.sbp).connect(this.sg).connect(this.out); this.sn.start();
    this.so1 = ctx.createOscillator(); this.so1.type = 'sawtooth'; this.so1.frequency.value = 1180;
    this.so2 = ctx.createOscillator(); this.so2.type = 'square'; this.so2.frequency.value = 1730;
    this.so3 = ctx.createOscillator(); this.so3.type = 'triangle'; this.so3.frequency.value = 2620;
    this.sob = ctx.createBiquadFilter(); this.sob.type = 'bandpass'; this.sob.frequency.value = 1500; this.sob.Q.value = 7;
    this.sog = ctx.createGain(); this.sog.gain.value = 0;
    this.sam = ctx.createGain(); this.sam.gain.value = 1; // modulacja amplitudy pisku
    this.slfo = ctx.createOscillator(); this.slfo.frequency.value = 38; this.slfoG = ctx.createGain(); this.slfoG.gain.value = 0.35; this.slfo.connect(this.slfoG).connect(this.sam.gain);
    this.slfo2 = ctx.createOscillator(); this.slfo2.frequency.value = 7; this.slfoV = ctx.createGain(); this.slfoV.gain.value = 40; // drżenie wysokości
    this.slfo2.connect(this.slfoV); this.slfoV.connect(this.so1.frequency); this.slfoV.connect(this.so2.frequency); this.slfoV.connect(this.so3.frequency);
    this.so1.connect(this.sob); this.so2.connect(this.sob); this.so3.connect(this.sob); this.sob.connect(this.sam).connect(this.sog).connect(this.out);
    [this.so1, this.so2, this.so3, this.slfo, this.slfo2].forEach((o) => o.start());
    // trawa / krawężnik: niski szum
    this.rn = noiseSrc();
    this.rlp = ctx.createBiquadFilter(); this.rlp.type = 'lowpass'; this.rlp.frequency.value = 500;
    this.rg = ctx.createGain(); this.rg.gain.value = 0;
    this.rn.connect(this.rlp).connect(this.rg).connect(this.out); this.rn.start();
    // kostka: rytmiczny dudniący stukot (częstość z prędkością); piasek: szum sypiącego się piasku
    this.cn = noiseSrc(); this.clp = ctx.createBiquadFilter(); this.clp.type = 'lowpass'; this.clp.frequency.value = 320; this.clp.Q.value = 0.9;
    this.cam = ctx.createGain(); this.cam.gain.value = 0.5; this.cg = ctx.createGain(); this.cg.gain.value = 0;
    this.clfo = ctx.createOscillator(); this.clfo.type = 'square'; this.clfo.frequency.value = 12; this.clfoG = ctx.createGain(); this.clfoG.gain.value = 0.5; this.clfo.connect(this.clfoG).connect(this.cam.gain);
    this.cn.connect(this.clp).connect(this.cam).connect(this.cg).connect(this.out);
    this.cbp = ctx.createBiquadFilter(); this.cbp.type = 'bandpass'; this.cbp.frequency.value = 1100; this.cbp.Q.value = 1.4; this.cg2 = ctx.createGain(); this.cg2.gain.value = 0; // „kliknięcia” kamieni
    this.cn.connect(this.cbp).connect(this.cam); this.cam.connect(this.cg2).connect(this.out);
    this.hn = noiseSrc(); this.hbp = ctx.createBiquadFilter(); this.hbp.type = 'bandpass'; this.hbp.frequency.value = 1500; this.hbp.Q.value = 0.5; this.hg = ctx.createGain(); this.hg.gain.value = 0;
    this.hlp = ctx.createBiquadFilter(); this.hlp.type = 'lowpass'; this.hlp.frequency.value = 380; this.hg2 = ctx.createGain(); this.hg2.gain.value = 0;
    this.hn.connect(this.hbp).connect(this.hg).connect(this.out); this.hn.connect(this.hlp).connect(this.hg2).connect(this.out);
    this.cn.start(); this.clfo.start(); this.hn.start(); this.surfK = 0;
    this.rpm = RPM_IDLE; this.gear = 0; this.cut = 0; this.lastThr = 0; this.popCd = 0; this.shiftCd = 0; this.limT = 0;
  }

  /** krótki wybuch szumu (strzał z wydechu, stuk skrzyni) */
  _burst(freq, gain, dur, q = 1, type = 'bandpass') {
    const t = ctx.currentTime, src = noiseSrc(), f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.out); src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }

  /** speed: prędkość względem maksymalnej (może przekraczać 1 z nitro), throttle 0..1, slip 0..1, rough 0..1, brake 0..1 */
  update({ speed, throttle, slip, rough, brake = 0, active = true, nitro = false, sandK = 0, cobK = 0 }, dt) {
    if (!this.on) return;
    const t = ctx.currentTime;
    const sp = Math.abs(speed);
    // --- skrzynia: zmiana biegu przy dobiciu do obrotów / zbyt niskich obrotach ---
    this.shiftCd -= dt; this.popCd -= dt;
    const topOf = (g) => GEAR_TOP[g];
    if (this.shiftCd <= 0 && this.gear < GEAR_TOP.length - 1 && sp > topOf(this.gear) * 0.985) { this.gear++; this.cut = 0.11; this.shiftCd = 0.35; if (throttle > 0.3) this._burst(260, 0.1, 0.07); }
    else if (this.shiftCd <= 0 && this.gear > 0 && sp < topOf(this.gear - 1) * 0.8) { this.gear--; this.shiftCd = 0.3; this.rpm += 1800; if (sp > 0.25 && throttle < 0.4) this._burst(500, 0.12, 0.09); }
    this.cut = Math.max(0, this.cut - dt);
    const g = this.gear;
    let want = Math.max(RPM_IDLE, RPM_MAX * sp / topOf(g));
    if (sp < 0.04) want = RPM_IDLE + throttle * 5200; // start: obroty rosną przy wciśniętym gazie
    else if (g === 0) want = Math.max(want, RPM_IDLE + throttle * 3600);
    want = Math.min(RPM_MAX, want);
    if (this.cut > 0) want = Math.max(RPM_IDLE, want - 2200); // przerwa w napędzie przy zmianie biegu
    this.rpm += (want - this.rpm) * Math.min(1, dt * (this.cut > 0 ? 25 : throttle > 0.1 ? 14 : 7));
    // ogranicznik obrotów: drżenie przy czerwonym polu
    const red = Math.max(0, (this.rpm - RPM_MAX * 0.955) / (RPM_MAX * 0.045));
    this.limT += dt;
    const lim = red > 0.5 && throttle > 0.5 ? (Math.sin(this.limT * 78) > 0.1 ? 1 : 0.62) : 1;
    const wob = 1 + (throttle > 0.2 ? Math.sin(this.limT * 9.3) * 0.004 + Math.sin(this.limT * 3.1) * 0.003 : 0);
    const rpm = this.rpm * wob;
    const f = rpm / 60 * 4; // częstotliwość zapłonów (silnik 8-cylindrowy, 4 zapłony na obrót)
    this.o1.frequency.setTargetAtTime(f, t, 0.02);
    this.o2.frequency.setTargetAtTime(f * 1.007 + 0.4, t, 0.02);
    this.o3.frequency.setTargetAtTime(f * 0.5, t, 0.02);
    this.o4.frequency.setTargetAtTime(f * 0.25, t, 0.03);
    const open = 0.25 + throttle * 0.75;
    this.lp.frequency.setTargetAtTime((650 + rpm * 0.55) * (0.55 + open * 0.8) * (this.cut > 0 ? 0.6 : 1), t, 0.04);
    this.pk.frequency.setTargetAtTime(500 + rpm * 0.28, t, 0.05);
    const load = throttle * 0.55 + 0.32;
    this.eg.gain.setTargetAtTime(active ? (0.1 + load * 0.5) * lim * (this.cut > 0 ? 0.45 : 1) * (0.7 + 0.3 * Math.min(1, rpm / 9000)) : 0, t, 0.03);
    // burble na zdjęciu gazu przy obrotach
    this.lfoG.gain.setTargetAtTime(throttle < 0.12 && rpm > 5000 ? 0.28 : 0, t, 0.08);
    this.lfo.frequency.setTargetAtTime(19 + rpm / 900, t, 0.1);
    this.out.gain.setTargetAtTime(this.volume, t, 0.1);
    // ssanie i szum wydechu
    this.ibp.frequency.setTargetAtTime(500 + rpm * 0.2, t, 0.05);
    this.ig.gain.setTargetAtTime(active ? (0.04 + throttle * 0.2) * Math.min(1, rpm / 7000) : 0, t, 0.05);
    // turbo: świst rośnie z obrotami i gazem, blow-off po puszczeniu pedału
    this.to.frequency.setTargetAtTime(1500 + rpm * 0.35, t, 0.05);
    this.tog.gain.setTargetAtTime(active ? throttle * Math.min(1, Math.max(0, (rpm - 5500) / 5000)) * 0.028 + (nitro ? 0.02 : 0) : 0, t, 0.06);
    if (this.lastThr > 0.7 && throttle < 0.15 && rpm > 6500 && this.popCd <= 0) {
      this.popCd = 0.8; this._burst(4200, 0.07, 0.4, 0.8, 'highpass');
      for (let i = 0; i < 2 + (Math.random() * 3 | 0); i++) setTimeout(() => { if (this.on && ctx) this._burst(240 + Math.random() * 500, 0.16, 0.06, 1.2); }, 70 + i * (60 + Math.random() * 90));
    }
    this.lastThr = throttle;
    // wiatr rośnie z kwadratem prędkości
    this.wbp.frequency.setTargetAtTime(500 + sp * 1600, t, 0.1);
    this.wg.gain.setTargetAtTime(active ? Math.min(1, sp * sp) * 0.2 : 0, t, 0.1);
    // opony: szum + pisk (zakręt w poślizgu, drift) oraz pisk hamowania na dużej prędkości
    const brk = brake > 0.5 && sp > 0.28 ? Math.min(1, (brake - 0.4) * 1.6) * Math.min(1, sp * 1.5) * 0.85 : 0;
    const surfMul = (1 - sandK * 0.85) * (1 - cobK * 0.55); // na piasku/kostce pisk jest cichszy, ale pojawia się inny dźwięk
    const sq = Math.min(1, Math.max(slip, brk)) * surfMul;
    this.sg.gain.setTargetAtTime((Math.min(1, slip) * 0.34 + brk * 0.18) * (1 - sandK * 0.5), t, 0.04);
    this.sog.gain.setTargetAtTime(sq ** 1.15 * 0.2, t, 0.05);
    this.slfoG.gain.setTargetAtTime(0.18 + sq * 0.35, t, 0.1);
    this.slfo.frequency.setTargetAtTime(30 + sq * 40, t, 0.1);
    const base = 980 + slip * 380 + sp * 260 + brk * 140;
    this.so1.frequency.setTargetAtTime(base, t, 0.05);
    this.so2.frequency.setTargetAtTime(base * 1.49, t, 0.05);
    this.so3.frequency.setTargetAtTime(base * 2.2, t, 0.05);
    this.sob.frequency.setTargetAtTime(1250 + slip * 700 + sp * 500, t, 0.05);
    this.sbp.frequency.setTargetAtTime(1500 + slip * 1000, t, 0.05);
    this.rg.gain.setTargetAtTime(Math.min(1, rough) * Math.min(1, sp * 2) * 0.5, t, 0.08);
    // kostka: stukot w rytmie kamieni (ok. 3 m między szwami), z prędkością rośnie częstość
    const mv = Math.min(1, sp * 1.6), ms = sp * 82; // prędkość w m/s
    this.clfo.frequency.setTargetAtTime(4 + ms / 2.4, t, 0.1);
    this.cg.gain.setTargetAtTime(active ? cobK * mv * 0.75 : 0, t, 0.08); this.cg2.gain.setTargetAtTime(active ? cobK * mv * 0.28 : 0, t, 0.08);
    // piasek: szorstki szum i niski chrzęst, bez pisku
    this.hbp.frequency.setTargetAtTime(1000 + sp * 1800, t, 0.1);
    this.hg.gain.setTargetAtTime(active ? sandK * mv * 0.34 : 0, t, 0.08); this.hg2.gain.setTargetAtTime(active ? sandK * mv * 0.5 : 0, t, 0.08);
    if ((sandK > 0.5) !== (this.surfK > 0.5) || (cobK > 0.5) !== (this.cobPrev > 0.5)) { if (active && sp > 0.1) this._burst(sandK > 0.5 ? 1800 : 400, 0.1, 0.18, 0.8); }
    this.surfK = sandK; this.cobPrev = cobK;
  }

  stop() {
    if (!this.on) return;
    const t = ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => { [this.o1, this.o2, this.o3, this.o4, this.lfo, this.cn, this.clfo, this.hn, this.in, this.to, this.wn, this.sn, this.rn, this.so1, this.so2, this.so3, this.slfo, this.slfo2].forEach((o) => { try { o.stop(); } catch { /* ok */ } }); this.out.disconnect(); }, 400);
  }
}

let rainNode = null;
export function setRain(on) {
  if (!ctx) return;
  if (on && !rainNode) {
    const src = noiseSrc(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 900; lp.type = 'lowpass'; lp.frequency.value = 7000; g.gain.value = 0.0001;
    src.connect(hp).connect(lp).connect(g).connect(master); src.start();
    g.gain.setTargetAtTime(0.11, ctx.currentTime, 0.6);
    rainNode = { src, g };
  } else if (!on && rainNode) {
    const n = rainNode; rainNode = null; n.g.gain.setTargetAtTime(0, ctx.currentTime, 0.3); setTimeout(() => { try { n.src.stop(); } catch { /* ok */ } }, 900);
  }
}

export const sfx = {
  tick(p = 0.5) { tone({ type: 'triangle', f: 380 + p * 900, dur: 0.05, gain: 0.1 }); },
  open() { tone({ type: 'sine', f: 330, f2: 520, dur: 0.14, gain: 0.14 }); tone({ type: 'triangle', f: 660, f2: 990, dur: 0.12, gain: 0.07, when: 0.05 }); },
  close() { tone({ type: 'sine', f: 520, f2: 300, dur: 0.14, gain: 0.14 }); },
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
  beep(go = false, n = 1) {
    if (go) { tone({ type: 'square', f: 1046, dur: 0.9, gain: 0.24, attack: 0.01 }); tone({ type: 'sawtooth', f: 1568, dur: 0.9, gain: 0.09 }); }
    else { tone({ type: 'square', f: 520 + (n - 1) * 40, dur: 0.16, gain: 0.2, attack: 0.005 }); tone({ type: 'sine', f: 1040 + (n - 1) * 80, dur: 0.12, gain: 0.07 }); }
  },
  lap() { tone({ type: 'triangle', f: 660, dur: 0.12, gain: 0.2 }); tone({ type: 'triangle', f: 990, dur: 0.18, gain: 0.2, when: 0.1 }); },
  kick(power = 0.5) {
    if (!ctx) return; const p = Math.min(1, power), t = ctx.currentTime;
    tone({ type: 'sine', f: 190 + 80 * p, f2: 70, dur: 0.16, gain: 0.3 * (0.4 + p) });
    const src = noiseSrc(), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.25 * p, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.1);
  },
  bounce(power = 0.5) { if (!ctx) return; const p = Math.min(1, power); tone({ type: 'sine', f: 150, f2: 90, dur: 0.1, gain: 0.18 * p }); },
  goal() {
    if (!ctx) return; const t = ctx.currentTime;
    const src = noiseSrc(), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.32, t + 0.5); g.gain.linearRampToValueAtTime(0.28, t + 2.0); g.gain.exponentialRampToValueAtTime(0.001, t + 3.4);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + 3.5);
    [392, 523, 659].forEach((f, i) => tone({ type: 'sawtooth', f, dur: 0.9, gain: 0.07, when: 0.1 + i * 0.02 }));
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', f, dur: 0.22, gain: 0.1, when: 0.9 + i * 0.12 }));
  },
  whistle() { tone({ type: 'sine', f: 2500, f2: 2900, dur: 0.45, gain: 0.12 }); tone({ type: 'sine', f: 2560, dur: 0.45, gain: 0.08, when: 0.02 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', f, dur: 0.28, gain: 0.14, when: i * 0.13 })); tone({ type: 'triangle', f: 1047, dur: 0.9, gain: 0.18, when: 0.55 }); },
  lose() { [392, 349, 311, 262].forEach((f, i) => tone({ type: 'triangle', f, dur: 0.32, gain: 0.2, when: i * 0.17 })); },
  click() { tone({ type: 'triangle', f: 520, f2: 760, dur: 0.07, gain: 0.12 }); },
  hover() { tone({ type: 'sine', f: 900, dur: 0.035, gain: 0.04 }); },
  pickup(type = 'generic') {
    const T = {
      nitro: () => { tone({ type: 'sawtooth', f: 200, f2: 900, dur: 0.28, gain: 0.14 }); tone({ type: 'sine', f: 1200, f2: 2400, dur: 0.2, gain: 0.1, when: 0.12 }); },
      ammo: () => { for (let i = 0; i < 3; i++) tone({ type: 'square', f: 420 + i * 120, dur: 0.05, gain: 0.12, when: i * 0.07 }); tone({ type: 'triangle', f: 1400, dur: 0.1, gain: 0.1, when: 0.24 }); },
      oil: () => { tone({ type: 'sine', f: 380, f2: 110, dur: 0.22, gain: 0.22 }); tone({ type: 'sine', f: 560, f2: 160, dur: 0.18, gain: 0.12, when: 0.08 }); },
      repair: () => { [880, 1175, 1568].forEach((f, i) => tone({ type: 'sine', f, dur: 0.22, gain: 0.14, when: i * 0.08 })); },
      bomb: () => { for (let i = 0; i < 3; i++) tone({ type: 'square', f: 760, dur: 0.05, gain: 0.12, when: i * 0.1 }); tone({ type: 'sine', f: 140, f2: 70, dur: 0.2, gain: 0.2, when: 0.32 }); },
      rocket: () => { tone({ type: 'sine', f: 1500, dur: 0.07, gain: 0.12 }); tone({ type: 'sine', f: 1500, dur: 0.07, gain: 0.12, when: 0.12 }); tone({ type: 'sawtooth', f: 300, f2: 1100, dur: 0.3, gain: 0.1, when: 0.24 }); },
      shield: () => { tone({ type: 'sine', f: 500, f2: 1500, dur: 0.4, gain: 0.14 }); tone({ type: 'triangle', f: 1000, f2: 3000, dur: 0.35, gain: 0.07, when: 0.05 }); },
      generic: () => { tone({ type: 'sine', f: 660, f2: 1320, dur: 0.18, gain: 0.2 }); tone({ type: 'triangle', f: 990, f2: 1980, dur: 0.22, gain: 0.12, when: 0.07 }); },
    };
    (T[type] || T.generic)();
  },
  /* kolizje zależne od materiału */
  wall(power = 0.5, pan = 0) {
    if (!ctx) return; const p = Math.min(1, power), t = ctx.currentTime;
    const src = noiseSrc(), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5 * p + 0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(bp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 0.45);
    tone({ type: 'sine', f: 820, dur: 0.45, gain: 0.12 * p + 0.03 }); tone({ type: 'sine', f: 1130, dur: 0.35, gain: 0.08 * p + 0.02 });
    tone({ type: 'sine', f: 120, f2: 50, dur: 0.2, gain: 0.35 * p + 0.1 });
  },
  carHit(power = 0.5) {
    if (!ctx) return; const p = Math.min(1, power), t = ctx.currentTime;
    const src = noiseSrc(), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.6 * p + 0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(bp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 0.35);
    tone({ type: 'sawtooth', f: 160, f2: 55, dur: 0.22, gain: 0.3 * p + 0.08 }); tone({ type: 'square', f: 300, f2: 90, dur: 0.08, gain: 0.06 * p });
  },
  pillar(power = 0.5) {
    if (!ctx) return; const p = Math.min(1, power), t = ctx.currentTime;
    const src = noiseSrc(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.7 * p + 0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(lp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 0.4);
    tone({ type: 'sine', f: 95, f2: 36, dur: 0.4, gain: 0.55 * p + 0.15 });
  },
  land(power = 0.5) { const p = Math.min(1, power); tone({ type: 'sine', f: 110, f2: 38, dur: 0.22, gain: 0.35 * p + 0.1 }); tone({ type: 'square', f: 220, f2: 80, dur: 0.06, gain: 0.06 * p }); },
  splash() {
    if (!ctx) return; const t = ctx.currentTime;
    const src = noiseSrc(), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(1800, t); bp.frequency.exponentialRampToValueAtTime(600, t + 0.5); bp.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    src.connect(bp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 0.6);
  },
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
  firework() {
    if (!ctx) return; const t = ctx.currentTime;
    tone({ type: 'sine', f: 500 + Math.random() * 400, f2: 1800, dur: 0.35, gain: 0.05 });
    const src = noiseSrc(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + 0.34); g.gain.exponentialRampToValueAtTime(0.28, t + 0.36); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    src.connect(hp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 1.2);
    tone({ type: 'sine', f: 140, f2: 50, dur: 0.3, gain: 0.25, when: 0.34 });
  },
  thunder() {
    if (!ctx) return; const t = ctx.currentTime;
    const src = noiseSrc(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(90, t + 2.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.08); g.gain.exponentialRampToValueAtTime(0.25, t + 0.7); g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    src.connect(lp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 2.7);
  },
  rocket() { tone({ type: 'sawtooth', f: 180, f2: 700, dur: 0.5, gain: 0.18 }); if (ctx) { const t = ctx.currentTime; const src = noiseSrc(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7); src.connect(bp).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 0.75); } },
  shield() { tone({ type: 'sine', f: 300, f2: 900, dur: 0.5, gain: 0.2 }); tone({ type: 'triangle', f: 600, f2: 1800, dur: 0.5, gain: 0.1, when: 0.05 }); },
  empty() { tone({ type: 'square', f: 200, dur: 0.06, gain: 0.08 }); },
  join() { tone({ type: 'sine', f: 600, dur: 0.1, gain: 0.15 }); tone({ type: 'sine', f: 900, dur: 0.16, gain: 0.15, when: 0.09 }); },
};
export const audioReady = () => !!ctx;
