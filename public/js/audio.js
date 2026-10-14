// Dźwięk gry (Web Audio API). Silnik, opony i wiatr budowane są z WARSTW PĘTLI: domyślnie generowanych w kodzie (synteza offline do AudioBuffer,
// pętle idealnie okresowe + crossfade na szwie, więc bez kliknięć); jeśli istnieje `sfx/manifest.json`, warstwy ładowane są z plików.
//
// FORMAT sfx/manifest.json (każdy plik MUSI mieć źródło i licencję; pliki CC-BY-SA i bez licencji są odrzucane):
//   { "engine": [ { "file": "engine_3600_on.ogg", "rpm": 3600, "load": "on", "source": "https://…", "license": "CC0" }, … ("load": "on" | "off"),
//     "roll": { "asphalt": {…}, "cobble": {…}, "sand": {…} }, "slide": {…}, "wind": {…} }
// Źródła i licencje użytych próbek wpisz w manifest (pole "source"/"license") i skopiuj do komentarza tu.
// Obecnie: ŻADNYCH plików zewnętrznych — wszystko generowane proceduralnie (brak kwestii licencyjnych).
let ctx = null, master = null, rvSend = null, noiseBuf = null, muted = false, sfxVol = 1;
try { const v = parseFloat(localStorage.getItem('tc_sfx')); if (Number.isFinite(v)) sfxVol = Math.min(1, Math.max(0, v)); } catch { /* brak storage */ }
try { muted = localStorage.getItem('tc_muted') === '1'; } catch { /* brak storage */ }

/** WSZYSTKIE strojenia na słuch w jednym miejscu (zmieniaj w konsoli: AUDIO_CONFIG.engine.rpmDownK = 4 itd. — nowe auta biorą wartości przy tworzeniu, część na bieżąco) */
export const AUDIO_CONFIG = {
  master: { gain: 0.7, volCurve: 2, compThreshold: -16, compRatio: 3.5, limiterThreshold: -3 }, // volCurve: wykładnik krzywej głośności (2 ≈ logarytmiczna dla ucha)
  engine: {
    cyl: 8, idleRpm: 3600, maxRpm: 12600,
    layersRpm: [3600, 5400, 7600, 9900, 12400],            // obroty bazowe pętli (4–6 warstw)
    loopSec: 1.0, xfadeSec: 0.04,                           // długość pętli i crossfade na szwie (dla szumów i próbek)
    gearTops: [0.16, 0.30, 0.45, 0.60, 0.75, 0.90, 1.05, 1.38],
    rpmUpK: 14, rpmDownK: 5,                                // inercja: stała wygładzania [1/s] — szybciej w górę niż w dół
    jitter: 0.005, idleJitter: 0.02,                        // mikro-drgania obrotów (ułamek)
    limiterFrac: 0.955, limiterHz: 15, limiterCut: 0.32, limiterDip: 0.012, // limiter: odcinanie zapłonu
    loadAttackSec: 0.06, loadReleaseSec: 0.22,              // wygładzanie obciążenia (przejście on/off-load)
    shiftCutSec: 0.11, shiftDropRpm: 2200, clunk: 0.22,     // zmiana biegu: przerwa w napędzie, spadek obrotów, szarpnięcie
    popChance: 0.7, popMinRpm: 6000,                        // strzały i blow-off przy zrzucaniu gazu
    level: 0.5,
  },
  tire: { rollLevel: 0.34, slideLevel: 0.36, squealLevel: 0.2, sandHiss: 0.34, cobbleRumble: 0.75 },
  wind: { level: 0.22, lpMin: 450, lpMax: 4800, bumpLevel: 0.25 },
  view: { interiorLp: 2400, interiorBoostDb: 7, interiorBoostHz: 85, interiorGain: 0.85, switchSec: 0.15 }, // miks wnętrze/zewnątrz
  doppler: { c: 343, scale: 1, min: 0.85, max: 1.2, smoothK: 12 },
  reverb: { sec: 0.55, decay: 3.2, wetBase: 0.05, wetMax: 0.24 }, // krótki pogłos zależny od otoczenia (setAmbience)
  ai: { layers: 2, wind: false },                                  // auta AI: tylko 2 warstwy silnika, bez wiatru
  samples: { enabled: true, manifest: 'sfx/manifest.json' },
};
const C = AUDIO_CONFIG;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const volCurve = (v) => v ** C.master.volCurve;
const masterLevel = () => (muted ? 0 : C.master.gain * volCurve(sfxVol));

/** krótki pogłos: wygenerowana odpowiedź impulsowa (szum z wykładniczym zanikiem) */
function makeIR(sec, decay) {
  const n = Math.round(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-decay * i / n * 3) * (1 - i / n); }
  return b;
}

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {}); // autoplay: start po geście użytkownika (initAudio woła się z handlerów klawisza/kliknięcia)
  master = ctx.createGain(); master.gain.value = masterLevel();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = C.master.compThreshold; comp.ratio.value = C.master.compRatio; comp.attack.value = 0.005; comp.release.value = 0.2;
  const lim = ctx.createDynamicsCompressor(); lim.threshold.value = C.master.limiterThreshold; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06; // limiter na końcu toru
  master.connect(comp).connect(lim).connect(ctx.destination);
  // wspólny pogłos (wysyłka z aut i efektów), poziom zależny od otoczenia
  const conv = ctx.createConvolver(); conv.buffer = makeIR(C.reverb.sec, C.reverb.decay);
  rvSend = ctx.createGain(); rvSend.gain.value = C.reverb.wetBase; rvSend.connect(conv); conv.connect(master);
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  bank = null; loadSamples();
}
export function isMuted() { return muted; }
export const getSfxVolume = () => sfxVol;
export function setSfxVolume(v) {
  sfxVol = Math.min(1, Math.max(0, v));
  try { localStorage.setItem('tc_sfx', String(sfxVol)); } catch { /* ignore */ }
  if (master) master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.03);
}
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('tc_muted', m ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.05);
}
let viewMix = 0; // 0 = zewnątrz (pełne pasmo), 1 = wnętrze (lowpass + dudnienie); dotyczy aut gracza
/** miks kamery: 'exterior' | 'interior' (wnętrze: lowpass ~2,4 kHz i podbicie dudnienia) */
export function setAudioView(mode) { viewMix = mode === 'interior' ? 1 : 0; }
/** otoczenie 0..1 (0 = otwarta przestrzeń, 1 = ciasno/odbicia: wąski tor, most) → ilość krótkiego pogłosu */
export function setAmbience(k) { if (rvSend) rvSend.gain.setTargetAtTime(C.reverb.wetBase + (C.reverb.wetMax - C.reverb.wetBase) * clamp01(k), ctx.currentTime, 0.4); }

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
// ======================= Banki warstw: synteza offline albo próbki =======================
let bank = null;
const EQ_C = 2 * Math.PI;

/** szew pętli bez kliknięć: z surowego sygnału `a` (długość N+X) robi pętlę długości N — koniec miksowany equal-power z początkiem */
function loopFromRaw(a, N, X) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (i < N - X) out[i] = a[i + X];
    else { const t = (i - (N - X)) / X; out[i] = a[i + X] * Math.cos(t * Math.PI / 2) + a[i - (N - X)] * Math.sin(t * Math.PI / 2); }
  }
  return out;
}
/** zdekodowany plik → pętla z crossfade na szwie */
function loopableBuffer(buf, xfadeSec) {
  const X = Math.min(Math.round(xfadeSec * buf.sampleRate), buf.length >> 2), N = buf.length - X, out = ctx.createBuffer(buf.numberOfChannels, N, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.getChannelData(ch).set(loopFromRaw(buf.getChannelData(ch), N, X));
  return out;
}
function noiseRaw(n) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.random() * 2 - 1; return a; }
/** filtr jednobiegunowy lowpass/highpass in-place (do kształtowania szumów w buforach) */
function onePole(a, hz, hp = false) { const k = 1 - Math.exp(-EQ_C * hz / ctx.sampleRate); let y = 0; for (let i = 0; i < a.length; i++) { y += (a[i] - y) * k; a[i] = hp ? a[i] - y : y; } return a; }
function bufferFrom(arr, norm = 0.9) { let m = 1e-6; for (let i = 0; i < arr.length; i++) m = Math.max(m, Math.abs(arr[i])); const b = ctx.createBuffer(1, arr.length, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < arr.length; i++) d[i] = arr[i] / m * norm; return b; }

/** jedna warstwa silnika dla obrotów `rpm` i obciążenia on/off: harmoniczne zapłonów (okresowe → pętla idealna) + szum wydechu/ssania */
function synthEngineLayer(rpm, on) {
  const E = C.engine, sr = ctx.sampleRate;
  const fire0 = rpm / 60 * E.cyl / 2;
  const cycles = Math.max(4, Math.round(fire0 * E.loopSec / 4) * 4), N = Math.round(cycles / fire0 * sr), fire = cycles / (N / sr); // całkowita liczba cykli i wielokrotność 4 (wzór nierównych zapłonów)
  const out = new Float32Array(N), H = 26, pw = on ? 0.82 : 1.2;
  for (let h = 1; h <= H; h++) {
    const hz = fire * h; if (hz > sr * 0.45) break;
    // formanty rury wydechowej (rosną z obrotami) + nieparzyste/parzyste
    const f1 = 420 + rpm * 0.12, f2 = 1500 + rpm * 0.25;
    let amp = h ** -pw * (h % 2 === 0 ? 1.28 : 1) * (1 + 1.6 * Math.exp(-(((hz - f1) / 260) ** 2)) + 1.0 * Math.exp(-(((hz - f2) / 700) ** 2)));
    if (on) amp *= 1 + 0.5 * Math.min(1, h / 12); else amp *= 0.7 * Math.exp(-h / 9);
    const ph = Math.random() * EQ_C, dw = EQ_C * hz / sr;
    for (let i = 0; i < N; i++) out[i] += amp * Math.sin(ph + dw * i);
  }
  // podharmoniczna 0,5 (leniwy warkot V8, mocniejsza pod obciążeniem) i modulacja co 4 zapłony (nierówna praca cylindrów)
  const sub = on ? 0.55 : 0.35, dws = EQ_C * fire * 0.5 / sr, dwm = EQ_C * fire * 0.25 / sr;
  for (let i = 0; i < N; i++) out[i] = (out[i] + sub * 2 * Math.sin(dws * i + 0.7)) * (1 + 0.08 * Math.sin(dwm * i + 1.3) + 0.04 * Math.sin(2 * dwm * i));
  // szum: ssanie/turbulencja (pętla z crossfade'm), modulowany częstością zapłonów
  const X = Math.round(E.xfadeSec * sr), raw = noiseRaw(N + X); onePole(raw, 900 + rpm * 0.4); onePole(raw, 200, true);
  const nz = loopFromRaw(raw, N, X), nAmp = on ? 0.5 : 0.18, dwf = EQ_C * fire / sr;
  for (let i = 0; i < N; i++) out[i] += nz[i] * nAmp * (1.4 + Math.sin(dwf * i)) ;
  return { buf: bufferFrom(out), hz: fire };
}
function synthLoop(shape, sec = 2) { // wspólny generator szumowych pętli
  const sr = ctx.sampleRate, N = Math.round(sec * sr), X = Math.round(C.engine.xfadeSec * sr), raw = noiseRaw(N + X);
  return bufferFrom(loopFromRaw(shape(raw, sr), N, X), 0.9);
}
function buildSynthBank() {
  const E = C.engine, b = { engine: { on: [], off: [] }, src: 'synth' };
  for (const rpm of E.layersRpm) { b.engine.on.push(synthEngineLayer(rpm, true)); b.engine.off.push(synthEngineLayer(rpm, false)); }
  // opony: toczenie na każdej nawierzchni (prędkość odtwarzania ~ prędkość auta), ślizg
  b.rollAsphalt = synthLoop((a) => { onePole(a, 3200); onePole(a, 350, true); return a; });
  b.rollCobble = synthLoop((a, sr) => { onePole(a, 420); const per = Math.round(sr / 7); for (let i = 0; i < a.length; i++) { const ph = (i % per) / per; a[i] *= 0.25 + 1.6 * Math.exp(-ph * 9); } return a; }); // rytm kamieni, ~7 stuków/s przy rate=1
  b.rollSand = synthLoop((a) => { const g = a.slice(); onePole(a, 3800); onePole(a, 700, true); onePole(g, 260); for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.9 + g[i] * 1.1 + (Math.random() < 0.002 ? (Math.random() - 0.5) * 3 : 0); return a; });
  b.slide = synthLoop((a, sr) => { onePole(a, 4300); onePole(a, 1100, true); for (let i = 0; i < a.length; i++) a[i] *= 0.7 + 0.3 * Math.sin(EQ_C * 31 * i / sr); return a; });
  b.wind = synthLoop((a) => { onePole(a, 2500); onePole(a, 120, true); return a; }, 3);
  b.thump = (() => { const n = Math.round(ctx.sampleRate * 0.16), a = noiseRaw(n); onePole(a, 260); for (let i = 0; i < n; i++) a[i] *= Math.exp(-i / n * 7); return bufferFrom(a); })();
  return b;
}
/** próbki z sfx/manifest.json: odrzuca pliki bez źródła/licencji i CC-BY-SA; błąd/brak pliku = zostaje synteza */
async function loadSamples() {
  if (!C.samples.enabled || !ctx) { bank = bank || buildSynthBank(); return; }
  bank = buildSynthBank(); // synteza od razu (gra nie czeka na pliki)
  try {
    const res = await fetch(C.samples.manifest, { cache: 'no-cache' }); if (!res.ok) return;
    const man = await res.json(), base = C.samples.manifest.replace(/[^/]*$/, '');
    const ok = (e) => e && e.file && e.source && e.license && !/-SA\b|ShareAlike/i.test(e.license);
    const load = async (e) => { if (!ok(e)) { console.warn('[audio] odrzucono próbkę (brak źródła/licencji lub CC-BY-SA):', e?.file); return null; } const buf = await ctx.decodeAudioData(await (await fetch(base + e.file)).arrayBuffer()); return loopableBuffer(buf, C.engine.xfadeSec); };
    const nb = { ...bank, src: 'samples', engine: { on: [], off: [] } };
    const lay = (man.engine || []).filter((e) => e.rpm).sort((a, b) => a.rpm - b.rpm);
    for (const kind of ['on', 'off']) for (const e of lay.filter((x) => x.load === kind)) { const buf = await load(e); if (buf) nb.engine[kind].push({ buf, hz: e.rpm / 60 * C.engine.cyl / 2, rpm: e.rpm }); }
    if (nb.engine.on.length >= 2 && nb.engine.off.length === nb.engine.on.length) { nb.layersRpm = nb.engine.on.map((l) => l.rpm); } else nb.engine = bank.engine;
    for (const [k, e] of [['rollAsphalt', man.roll?.asphalt], ['rollCobble', man.roll?.cobble], ['rollSand', man.roll?.sand], ['slide', man.slide], ['wind', man.wind]]) { const buf = e && await load(e); if (buf) nb[k] = buf; }
    bank = nb; // auta tworzone od teraz używają próbek (istniejące zostają przy syntezie do następnego wyścigu)
  } catch (e) { console.warn('[audio] próbki niedostępne, synteza:', e?.message); }
}

// ======================= Auto: silnik + opony + wiatr =======================
const wEq = new Float32Array(8); // wagi warstw (prealokowane)
/** equal-power: wagi sąsiednich warstw dla wartości x między progami */
function layerWeights(rpm, R, out) {
  out.fill(0); const n = R.length;
  if (rpm <= R[0]) { out[0] = 1; return; } if (rpm >= R[n - 1]) { out[n - 1] = 1; return; }
  let i = 0; while (i < n - 2 && rpm > R[i + 1]) i++;
  const t = (rpm - R[i]) / (R[i + 1] - R[i]); out[i] = Math.cos(t * Math.PI / 2); out[i + 1] = Math.sin(t * Math.PI / 2);
}

/**
 * Silnik (4–6 warstw RPM × on/off-load, equal-power, playbackRate z obrotów; inercja, mikrodrgania, limiter, biegi, strzały),
 * opony (toczenie/ślizg/pisk po nawierzchni), wiatr (∝ prędkość²), miks wnętrze/zewnątrz, Doppler.
 * opts.lite = auto AI: tylko 2 warstwy silnika (on), bez wiatru.
 */
export class CarAudio {
  constructor(volume = 1, pan = 0, opts = {}) {
    this.on = !!ctx;
    if (!ctx) return;
    if (!bank) bank = buildSynthBank();
    this.lite = !!opts.lite; this.player = !this.lite;
    const B = bank, E = C.engine;
    this.volume = volume; this.out = ctx.createGain(); this.out.gain.value = 0;
    // ścieżki: zewnątrz (pełne pasmo) i wnętrze (lowpass + dudnienie) — miks przełączany setAudioView
    this.bus = ctx.createGain();
    this.ext = ctx.createGain(); this.bus.connect(this.ext).connect(this.out);
    if (this.player) {
      this.intLp = ctx.createBiquadFilter(); this.intLp.type = 'lowpass'; this.intLp.frequency.value = C.view.interiorLp; this.intLp.Q.value = 0.7;
      this.intSh = ctx.createBiquadFilter(); this.intSh.type = 'peaking'; this.intSh.frequency.value = C.view.interiorBoostHz; this.intSh.Q.value = 0.9; this.intSh.gain.value = C.view.interiorBoostDb;
      this.int = ctx.createGain(); this.int.gain.value = 0; this.bus.connect(this.intLp).connect(this.intSh).connect(this.int).connect(this.out);
    }
    this.panner = ctx.createStereoPanner(); this.panner.pan.value = pan;
    this.out.connect(this.panner).connect(master); const rs = ctx.createGain(); rs.gain.value = 0.9; this.panner.connect(rs).connect(rvSend);
    // silnik: źródła pętli
    this.R = bank.layersRpm || E.layersRpm; this.nL = this.R.length;
    const layIdx = this.lite ? [1, this.nL - 2] : this.R.map((_, i) => i);
    this.eng = []; // { src, g, kind, i }
    for (const kind of this.lite ? ['on'] : ['on', 'off']) for (const i of layIdx) {
      const l = B.engine[kind][i]; if (!l) continue;
      const src = ctx.createBufferSource(); src.buffer = l.buf; src.loop = true; const g = ctx.createGain(); g.gain.value = 0;
      src.connect(g).connect(this.bus); src.start(0, Math.random() * 0.5);
      this.eng.push({ src, g, kind, i, hz: l.hz });
    }
    this.layIdx = layIdx;
    // opony
    const loopSrc = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; const g = ctx.createGain(); g.gain.value = 0; s.connect(g).connect(this.bus); s.start(0, Math.random()); return { s, g }; };
    this.rollA = loopSrc(B.rollAsphalt); this.rollC = loopSrc(B.rollCobble); this.rollS = loopSrc(B.rollSand); this.slide = loopSrc(B.slide);
    this.sq1 = ctx.createOscillator(); this.sq1.type = 'sawtooth'; this.sq2 = ctx.createOscillator(); this.sq2.type = 'square'; this.sq3 = ctx.createOscillator(); this.sq3.type = 'triangle';
    this.sqf = ctx.createBiquadFilter(); this.sqf.type = 'bandpass'; this.sqf.Q.value = 7; this.sqg = ctx.createGain(); this.sqg.gain.value = 0; this.sqm = ctx.createGain(); this.sqm.gain.value = 1;
    this.sql = ctx.createOscillator(); this.sql.frequency.value = 38; this.sqlg = ctx.createGain(); this.sqlg.gain.value = 0.3; this.sql.connect(this.sqlg).connect(this.sqm.gain);
    this.sq1.connect(this.sqf); this.sq2.connect(this.sqf); this.sq3.connect(this.sqf); this.sqf.connect(this.sqm).connect(this.sqg).connect(this.bus);
    [this.sq1, this.sq2, this.sq3, this.sql].forEach((o) => o.start());
    // wiatr
    if (!this.lite || C.ai.wind) { this.wind = loopSrc(B.wind); this.windLp = ctx.createBiquadFilter(); this.windLp.type = 'lowpass'; this.windLp.frequency.value = C.wind.lpMin; this.wind.g.disconnect(); this.wind.g.connect(this.windLp).connect(this.bus); }
    // stan
    this.rpm = E.idleRpm; this.gear = 0; this.load = 0; this.cut = 0; this.lastThr = 0; this.popCd = 0; this.shiftCd = 0; this.limT = 0; this.limPhase = 0; this.jit = 0; this.dop = 1; this.viewK = 0; this.bumpT = 0; this.surfPrevS = 0; this.surfPrevC = 0;
  }

  _burst(freq, gain, dur, q = 1, type = 'bandpass') { // krótkie zdarzenia (rzadko, nie w pętli klatek): strzały, szarpnięcia
    const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.bus); src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }
  /** tąpnięcie na nierówności / lądowaniu / krawężniku */
  thump(power = 0.5) {
    if (!this.on) return; const t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = bank.thump; const g = ctx.createGain(); g.gain.value = Math.min(1, power) * C.wind.bumpLevel * 2; s.playbackRate.value = 0.8 + Math.random() * 0.5;
    s.connect(g).connect(this.bus); s.start(t);
  }

  /**
   * speed: prędkość względem maksymalnej (z nitro >1), throttle 0..1, slip 0..1, brake 0..1, rough 0..1,
   * sandK/cobK 0..1 (nawierzchnia), doppler = współczynnik wysokości (1 = brak) liczony w main z prędkości względnej
   */
  update({ speed, throttle, slip, rough, brake = 0, active = true, nitro = false, sandK = 0, cobK = 0, doppler = 1 }, dt) {
    if (!this.on) return;
    const t = ctx.currentTime, E = C.engine, sp = Math.abs(speed), tires = C.tire;
    // --- skrzynia: zmiana biegu przy dobiciu do obrotów / zbyt niskich obrotach ---
    this.shiftCd -= dt; this.popCd -= dt;
    const tops = E.gearTops;
    if (this.shiftCd <= 0 && this.gear < tops.length - 1 && sp > tops[this.gear] * 0.985) { this.gear++; this.cut = E.shiftCutSec; this.shiftCd = 0.35; this.rpm = Math.max(E.idleRpm, this.rpm - E.shiftDropRpm); if (throttle > 0.3) { this._burst(240, E.clunk, 0.08, 1.2, 'lowpass'); this.thump(0.3); } }
    else if (this.shiftCd <= 0 && this.gear > 0 && sp < tops[this.gear - 1] * 0.8) { this.gear--; this.shiftCd = 0.3; this.rpm += 1800; if (sp > 0.25 && throttle < 0.4) this._burst(500, 0.12, 0.09); }
    this.cut = Math.max(0, this.cut - dt);
    const g = this.gear;
    let want = Math.max(E.idleRpm, E.maxRpm * sp / tops[g]);
    if (sp < 0.04) want = E.idleRpm + throttle * 5200; else if (g === 0) want = Math.max(want, E.idleRpm + throttle * 3600);
    want = Math.min(E.maxRpm, want);
    // inercja: szybciej w górę niż w dół; przerwa w napędzie przy biegu obniża obroty
    if (this.cut > 0) want = Math.max(E.idleRpm, want - E.shiftDropRpm);
    this.rpm += (want - this.rpm) * (1 - Math.exp(-dt * (want > this.rpm ? E.rpmUpK : E.rpmDownK) * (throttle > 0.1 || want > this.rpm ? 1 : 0.7)));
    // limiter: odcinanie zapłonu (na przemian obcięcie obciążenia) + lekki spadek obrotów
    const red = clamp01((this.rpm - E.maxRpm * E.limiterFrac) / (E.maxRpm * (1 - E.limiterFrac)));
    this.limPhase += dt * E.limiterHz; const cutting = red > 0.4 && throttle > 0.5 && (this.limPhase % 1) < 0.42;
    // mikro-drgania obrotów (ruchome, wygładzone losowe)
    this.jit += ((Math.random() - 0.5) * 2 - this.jit) * Math.min(1, dt * 22);
    const rpm = this.rpm * (1 + this.jit * (throttle < 0.12 && sp < 0.1 ? E.idleJitter : E.jitter)) * (cutting ? 1 - E.limiterDip : 1);
    // obciążenie (on/off-load): wygładzone, przy zmianie biegu i odcięciu zapłonu spada
    const loadT = (this.cut > 0 || cutting) ? (cutting ? E.limiterCut : 0) : throttle;
    this.load += (loadT - this.load) * (1 - Math.exp(-dt / (loadT > this.load ? E.loadAttackSec : E.loadReleaseSec)));
    const onW = Math.sin(this.load * Math.PI / 2), offW = Math.cos(this.load * Math.PI / 2);
    layerWeights(rpm, this.R, wEq);
    this.dop += (doppler - this.dop) * Math.min(1, dt * C.doppler.smoothK);
    const dopK = Math.min(C.doppler.max, Math.max(C.doppler.min, 1 + (this.dop - 1) * C.doppler.scale));
    const fire = rpm / 60 * E.cyl / 2 * dopK;
    const act = active ? 1 : 0;
    // poziom silnika rośnie z obrotami i obciążeniem
    const level = E.level * (0.55 + 0.45 * clamp01(rpm / 9000)) * (0.35 + 0.65 * (0.4 + this.load * 0.6)) * act;
    for (const L of this.eng) {
      const w = this.lite ? (L.i === this.layIdx[0] ? Math.cos(clamp01((rpm - this.R[this.layIdx[0]]) / (this.R[this.layIdx[1]] - this.R[this.layIdx[0]])) * Math.PI / 2) : Math.sin(clamp01((rpm - this.R[this.layIdx[0]]) / (this.R[this.layIdx[1]] - this.R[this.layIdx[0]])) * Math.PI / 2)) : wEq[L.i];
      L.g.gain.setTargetAtTime(w * (L.kind === 'on' ? (this.lite ? 1 : onW) : offW) * level, t, 0.03);
      L.src.playbackRate.setTargetAtTime(fire / L.hz, t, 0.02);
    }
    // blow-off / strzały przy zrzucaniu gazu z wysokich obrotów
    if (this.lastThr > 0.7 && throttle < 0.15 && rpm > E.popMinRpm && this.popCd <= 0 && !this.lite) {
      this.popCd = 0.8; this._burst(4200, 0.07, 0.4, 0.8, 'highpass');
      if (Math.random() < E.popChance) for (let i = 0, n = 2 + (Math.random() * 3 | 0); i < n; i++) setTimeout(() => { if (this.on && ctx) this._burst(240 + Math.random() * 500, 0.16, 0.06, 1.2); }, 70 + i * (60 + Math.random() * 90));
    }
    this.lastThr = throttle;
    // --- opony ---
    const surfA = clamp01(1 - sandK - cobK), surfC = cobK * (1 - sandK), surfS = sandK;
    const mv = Math.min(1, sp * 1.6), sl = clamp01(slip), brk = brake > 0.5 && sp > 0.28 ? Math.min(1, (brake - 0.4) * 1.6) * Math.min(1, sp * 1.5) * 0.85 : 0;
    const sx = Math.max(sl, brk), rollFade = Math.cos(clamp01(sx / 0.85) * Math.PI / 2), slideW = Math.sin(clamp01(sx / 0.85) * Math.PI / 2) * (1 - 0.4 * surfS);
    const sqW = clamp01((sx - 0.42) / 0.58) * (1 - 0.85 * surfS) * (1 - 0.55 * surfC) * (1 - 0.5 * surfS);
    this.rollA.g.gain.setTargetAtTime(act * surfA * mv * tires.rollLevel * rollFade, t, 0.06); this.rollA.s.playbackRate.setTargetAtTime((0.7 + sp * 0.9) * dopK, t, 0.1);
    this.rollC.g.gain.setTargetAtTime(act * surfC * mv * tires.cobbleRumble * tires.rollLevel * 1.4, t, 0.06); this.rollC.s.playbackRate.setTargetAtTime(0.4 + sp * 2.4, t, 0.1);
    this.rollS.g.gain.setTargetAtTime(act * surfS * mv * tires.sandHiss * 1.2, t, 0.06); this.rollS.s.playbackRate.setTargetAtTime(0.8 + sp * 0.6, t, 0.1);
    this.slide.g.gain.setTargetAtTime(act * slideW * mv * tires.slideLevel, t, 0.05);
    const base = 980 + sl * 380 + sp * 260 + brk * 140;
    this.sq1.frequency.setTargetAtTime(base * dopK, t, 0.05); this.sq2.frequency.setTargetAtTime(base * 1.49 * dopK, t, 0.05); this.sq3.frequency.setTargetAtTime(base * 2.2 * dopK, t, 0.05);
    this.sqf.frequency.setTargetAtTime(1250 + sl * 700 + sp * 500, t, 0.05);
    this.sqg.gain.setTargetAtTime(act * sqW ** 1.15 * tires.squealLevel, t, 0.05); this.sqlg.gain.setTargetAtTime(0.18 + sqW * 0.35, t, 0.1); this.sql.frequency.setTargetAtTime(30 + sqW * 40, t, 0.1);
    // przejście między nawierzchniami: krótki trzask
    if ((sandK > 0.5) !== (this.surfPrevS > 0.5) || (cobK > 0.5) !== (this.surfPrevC > 0.5)) { if (active && sp > 0.1) this._burst(sandK > 0.5 ? 1800 : 400, 0.1, 0.18, 0.8); }
    this.surfPrevS = sandK; this.surfPrevC = cobK;
    // --- wiatr: głośność ∝ speed², lowpass rośnie z prędkością; tąpnięcia na nierównościach ---
    if (this.wind) {
      this.windLp.frequency.setTargetAtTime(C.wind.lpMin + (C.wind.lpMax - C.wind.lpMin) * Math.min(1, sp), t, 0.1);
      this.wind.g.gain.setTargetAtTime(act * Math.min(1.5, sp * sp) * C.wind.level, t, 0.1); this.wind.s.playbackRate.value = 0.85 + sp * 0.3;
    }
    this.bumpT -= dt; if ((cobK > 0.25 || rough > 0.1) && sp > 0.2 && this.bumpT <= 0 && active) { this.bumpT = 0.12 + Math.random() * 0.18 / (0.3 + sp); this.thump(0.12 + 0.25 * Math.max(cobK, rough) * sp); }
    // --- miks wnętrze/zewnątrz (equal-power) i głośność auta ---
    if (this.player) {
      this.viewK += (viewMix - this.viewK) * Math.min(1, dt / C.view.switchSec);
      this.ext.gain.setTargetAtTime(Math.cos(this.viewK * Math.PI / 2), t, 0.03); this.int.gain.setTargetAtTime(Math.sin(this.viewK * Math.PI / 2) * C.view.interiorGain, t, 0.03);
    }
    this.out.gain.setTargetAtTime(this.volume, t, 0.1);
  }

  stop() {
    if (!this.on) return;
    this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    setTimeout(() => { const all = [...this.eng.map((l) => l.src), this.rollA.s, this.rollC.s, this.rollS.s, this.slide.s, this.sq1, this.sq2, this.sq3, this.sql]; if (this.wind) all.push(this.wind.s); all.forEach((o) => { try { o.stop(); } catch { /* ok */ } }); this.out.disconnect(); }, 400);
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
