// Definicje torów: zamknięte pętle (okrążenia) z bandami na całej długości. Punkty [x, z] w metrach × scale, hills = [amplituda, fale, faza].
import { Track3D } from './track3d.js';

export const TRACK_DEFS = {
  stadion: {
    name: 'Stadion Mistrzów', tag: 'Klasyczny owal z szykaną i długą prostą startową', theme: 'stadion', y0: 0, scale: 4.8, maxBank: 14,
    points: [[-40, 45], [10, 47], [55, 45], [90, 30], [96, 2], [80, -24], [56, -32], [40, -16], [20, -6], [-4, -16], [-18, -42], [-50, -52], [-86, -40], [-98, -10], [-82, 18], [-64, 34]],
    zones: [{ a: 0.28, b: 0.40, type: 'cobble' }, { a: 0.55, b: 0.68, type: 'bridge' }],
    hills: [[2.5, 2, 0.6]],
  },
  tokyo: {
    name: 'Neo Tokio', tag: 'Nocne miasto: techniczne zakręty między wieżowcami', theme: 'tokyo', y0: 0, scale: 3.7, maxBank: 12,
    points: [[-70, 50], [0, 52], [70, 50], [112, 36], [124, 6], [104, -14], [74, -10], [58, 8], [34, 20], [10, 8], [8, -18], [34, -34], [58, -58], [40, -84], [6, -88], [-24, -70], [-60, -62], [-100, -52], [-124, -22], [-116, 14], [-96, 38]],
    zones: [{ a: 0.18, b: 0.30, type: 'tunnel' }, { a: 0.45, b: 0.62, type: 'bridge' }, { a: 0.72, b: 0.80, type: 'cobble' }],
    hills: [[2, 3, 0]],
  },
  alpy: {
    name: 'Przełęcz Alpejska', tag: 'Górska pętla: wzniesienia i serpentyny', theme: 'alpy', y0: 70, scale: 4.0, maxBank: 16,
    points: [[-60, 60], [0, 62], [60, 56], [104, 38], [118, 6], [96, -22], [64, -30], [48, -54], [66, -84], [42, -112], [0, -104], [-20, -78], [-52, -70], [-84, -86], [-120, -66], [-124, -28], [-100, -2], [-110, 28], [-92, 50]],
    zones: [{ a: 0.20, b: 0.30, type: 'tunnel' }, { a: 0.40, b: 0.50, type: 'bridge' }, { a: 0.62, b: 0.70, type: 'cobble' }, { a: 0.80, b: 0.88, type: 'tunnel' }],
    hills: [[14, 2, 0.3], [5, 5, 1.2]],
  },
  egipt: {
    name: 'Pustynia Faraonów', tag: 'Szerokie łuki wokół piramid i długie proste', theme: 'egipt', y0: 0, scale: 3.0, maxBank: 12,
    points: [[-90, 60], [-30, 60], [30, 60], [90, 62], [140, 48], [168, 8], [152, -28], [112, -32], [86, -58], [104, -86], [142, -96], [156, -126], [118, -144], [66, -132], [26, -98], [-20, -114], [-76, -124], [-132, -104], [-164, -58], [-150, -8], [-136, 34], [-122, 58]],
    zones: [{ a: 0.20, b: 0.40, type: 'sand' }, { a: 0.50, b: 0.58, type: 'bridge' }, { a: 0.65, b: 0.80, type: 'sand' }, { a: 0.88, b: 0.94, type: 'cobble' }],
    hills: [[4, 2, 1]],
  },
  tropiki: {
    name: 'Wyspy Hawajskie', tag: 'Wyspa nad oceanem: zatoki i nadmorskie szykany', theme: 'tropiki', y0: 6, scale: 4.3, maxBank: 14,
    points: [[-80, 40], [-30, 52], [30, 50], [80, 38], [112, 10], [100, -22], [66, -34], [40, -22], [20, -44], [30, -76], [4, -98], [-34, -88], [-48, -58], [-80, -48], [-112, -22], [-110, 12]],
    zones: [{ a: 0.15, b: 0.30, type: 'sand' }, { a: 0.40, b: 0.55, type: 'bridge' }, { a: 0.70, b: 0.78, type: 'cobble' }, { a: 0.85, b: 0.93, type: 'sand' }],
    hills: [[4, 3, 0.4]],
  },
};
export const TRACK_IDS = Object.keys(TRACK_DEFS);
export const buildTrack = (id) => new Track3D({ ...TRACK_DEFS[id], id });
