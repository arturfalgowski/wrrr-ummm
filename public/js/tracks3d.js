// Definicje torów: zamknięte pętle (okrążenia) z bandami na całej długości.
// Trasa składa się z prostych i łuków o znanych promieniach (`arc`), a krzywa Catmull-Rom wygładza tylko styki.
// points = [x, z] w metrach (× scale), startAt = punkt linii startu, elev = profil wysokości [ułamek okrążenia od startu, wysokość m],
// zones = {a, b, type: cobble|sand|bridge} jako ułamki okrążenia od startu.
// hw = domyślna połowa szerokości jezdni (12 m = tor 24 m), width = [[a, b, hw], …] zwężenia (hw 8 = 16 m) i poszerzenia na zakrętach (14–15).
import { Track3D } from './track3d.js';

const RAD = Math.PI / 180;
/** łuk okręgu o środku (cx, cz) i promieniu r od kąta a0 do a1 [°] (x = cx + r·cos, z = cz + r·sin), punkty co `step` stopni */
const arc = (cx, cz, r, a0, a1, step = 30) => {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step)), o = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * RAD; o.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return o;
};
/** skleja punkty i łuki w jedną listę (usuwa powtórzone styki) */
const path = (...parts) => {
  const out = [];
  for (const p of parts.flatMap((q) => (typeof q[0] === 'number' ? [q] : q))) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 3) out.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]); }
  const f = out[0], l = out[out.length - 1]; if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= 3) out.pop();
  return out;
};

export const TRACK_DEFS = {
  // krótki i techniczny: cztery agrafki, szykana i kostka (~2,1 km)
  stadion: {
    name: 'Stadion Mistrzów', tag: 'Krótki i techniczny: agrafki, wąska szykana i kostka', theme: 'stadion', y0: 0, scale: 1, maxBank: 14, startAt: [-100, 0],
    points: path([-250, 0], [-100, 0], [50, 0], [150, 0], arc(150, 45, 45, -90, 90), [90, 90], [50, 103], [10, 125], [-30, 130], arc(-110, 140, 50, -60, -180), [-160, 200], arc(-110, 200, 50, 180, 90), [0, 250], [100, 250],
      arc(100, 300, 50, -90, 90), [0, 350], [-150, 350], arc(-250, 300, 50, 90, 180), [-300, 200], [-300, 100], arc(-250, 50, 50, 180, 270)),
    elev: [[0, 0], [0.15, 2], [0.3, 9], [0.45, 10], [0.6, 2], [0.75, -1], [0.9, 0]],
    width: [[0.12, 0.177, 15], [0.43, 0.49, 8], [0.513, 0.576, 15], [0.62, 0.67, 8], [0.899, 0.926, 14]],
    zones: [{ a: 0.42, b: 0.50, type: 'cobble' }, { a: 0.60, b: 0.69, type: 'bridge' }],
  },
  // średni, szybki: jesienny las w Kanadzie, długa prosta, esy-floresy i wiadukt (~3 km)
  jesien: {
    name: 'Złota Jesień', tag: 'Szybki: leśne przesmyki, drewniany wiadukt, długa prosta i esy', theme: 'jesien', y0: 0, scale: 1.45, maxBank: 12, startAt: [-130, 0],
    points: path([-290, 0], [-130, 0], [20, 0], [120, 0], arc(120, 70, 70, -90, 0), [190, 150], arc(250, 150, 60, 180, 90), [330, 210], [400, 210], arc(400, 255, 45, -90, 90), [330, 300], [250, 325], [170, 320], [90, 295], [20, 285], [-60, 300], [-140, 330],
      arc(-140, 240, 90, 90, 180), [-230, 150], arc(-290, 150, 60, 0, -90), arc(-290, 45, 45, 90, 270)),
    elev: [[0, 0], [0.2, 6], [0.35, 14], [0.5, 8], [0.65, 16], [0.8, 6], [0.95, 1]],
    width: [[0.28, 0.33, 8], [0.346, 0.406, 14], [0.857, 0.915, 15]],
    zones: [{ a: 0.48, b: 0.60, type: 'bridge' }, { a: 0.74, b: 0.80, type: 'cobble' }],
  },
  // długi i trudny: dwa piętra serpentyn (podjazd i zjazd), 8 agrafek, wąska grań na przełęczy (~5,5 km)
  alpy: {
    name: 'Przełęcz Alpejska', tag: 'Długi i trudny: serpentyny, agrafki i wąska grań', theme: 'alpy', y0: 0, scale: 1.12, maxBank: 16, startAt: [-300, 500],
    points: path([-420, 500], [-250, 500], [-90, 500], arc(-90, 450, 50, 90, -90), [-250, 410], [-370, 400], arc(-370, 350, 50, 90, 270), [-250, 300], [-90, 300], arc(-90, 250, 50, 90, -90), [-250, 200], [-370, 200],
      arc(-370, 150, 50, 90, 270), [-250, 90], [-90, 92], [60, 100], [200, 100], [380, 100], arc(380, 150, 50, -90, 90), [250, 200], [110, 200], arc(110, 250, 50, -90, -270), [250, 300], [380, 300],
      arc(380, 350, 50, -90, 90), [250, 412], [110, 400], arc(110, 460, 60, -90, -180), [50, 540], arc(-10, 540, 60, 0, 90), [-150, 600], [-350, 600], arc(-470, 550, 50, 90, 270)),
    elev: [[0, 0], [0.1, 12], [0.2, 35], [0.3, 62], [0.4, 92], [0.47, 115], [0.52, 120], [0.6, 100], [0.7, 70], [0.8, 40], [0.9, 15], [0.97, 3]],
    width: [[0.139, 0.167, 14], [0.23, 0.258, 14], [0.322, 0.35, 14], [0.37, 0.46, 8], [0.512, 0.54, 14], [0.64, 0.68, 8], [0.691, 0.719, 14], [0.934, 0.962, 14]],
    zones: [{ a: 0.08, b: 0.135, type: 'bridge' }, { a: 0.545, b: 0.595, type: 'cobble' }, { a: 0.64, b: 0.685, type: 'bridge' }, { a: 0.85, b: 0.92, type: 'bridge' }],
  },
  // ogromne proste (1,2 km) i szerokie łuki wśród piramid, piasek i bazar (~3,7 km)
  egipt: {
    name: 'Pustynia Faraonów', tag: 'Ogromne proste i szerokie łuki: piasek i piramidy', theme: 'egipt', y0: 0, scale: 1, maxBank: 12, startAt: [-300, 0],
    points: path([-400, 0], [-100, 0], [100, -12], [300, 0], [500, 0], arc(500, 200, 200, -90, 90, 20), [400, 400], arc(300, 445, 45, -90, -270), [360, 490], arc(420, 535, 45, -90, 90), [300, 580], [150, 565], [-50, 595], [-200, 580], [-300, 580], arc(-500, 290, 290, 90, 270, 20)),
    elev: [[0, 0], [0.2, 3], [0.4, 9], [0.55, 4], [0.7, 8], [0.85, 2]],
    width: [[0.403, 0.433, 15], [0.435, 0.465, 8], [0.467, 0.498, 15], [0.56, 0.6, 8], [0.8, 0.84, 8]],
    zones: [{ a: 0.12, b: 0.20, type: 'sand' }, { a: 0.345, b: 0.395, type: 'bridge' }, { a: 0.44, b: 0.49, type: 'cobble' }, { a: 0.55, b: 0.70, type: 'sand' }, { a: 0.78, b: 0.86, type: 'sand' }],
  },
  // średni, płynny: zatoki, plaża, esy nad oceanem i agrafka na cyplu (~3,5 km)
  tropiki: {
    name: 'Wyspy Hawajskie', tag: 'Płynny: nadmorskie łuki, plaża i schodkowa zatoka', theme: 'tropiki', y0: 6, scale: 1.25, maxBank: 14, startAt: [-130, 0],
    points: path([-250, 0], [-130, 0], [0, 0], arc(0, 70, 70, -90, 0), [70, 110], arc(140, 110, 70, 180, 90), [220, 180], arc(220, 250, 70, -90, 0), [290, 310], arc(360, 310, 70, 180, 90), [420, 380], arc(420, 450, 70, -90, 0), arc(420, 450, 70, 0, 90),
      [320, 520], [240, 545], [160, 535], [80, 510], [0, 505], [-80, 525], [-170, 505], [-300, 525], arc(-300, 435, 90, 90, 180), [-390, 330], [-390, 200], arc(-250, 140, 140, 180, 270)),
    elev: [[0, 0], [0.2, 4], [0.4, 9], [0.55, 3], [0.7, 7], [0.85, 2]],
    width: [[0.194, 0.286, 14], [0.31, 0.37, 8], [0.754, 0.8, 8]],
    zones: [{ a: 0.12, b: 0.20, type: 'sand' }, { a: 0.30, b: 0.38, type: 'bridge' }, { a: 0.60, b: 0.65, type: 'cobble' }, { a: 0.70, b: 0.80, type: 'sand' }],
  },
};
export const TRACK_IDS = Object.keys(TRACK_DEFS);
export const buildTrack = (id) => new Track3D({ ...TRACK_DEFS[id], id });
