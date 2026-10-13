// Definicje torów w stylu TrackMania (A → B). Każdy tor ma motyw otoczenia („kraj”), porę dnia i listę elementów.
import { Track3D, S, C, P, LOOP, HILL, JUMP } from './track3d.js';

export const TRACK_DEFS = {
  stadion: {
    name: 'Stadion Mistrzów', tag: 'Klasyczny stadion: pętla, skoki i pochylone nawroty', theme: 'stadion', y0: 0,
    ops: [S(110, { pad: { lane: -1 } }), C(90, 75, { bank: 18 }), S(70, { bank: 0 }), C(-90, 75, { bank: -18 }), S(90, { bank: 0 }),
      JUMP(18, 100), S(70), LOOP(30, 42), S(80, { pad: { lane: 1 } }), C(180, 62, { bank: 26 }), S(70, { bank: 0 }), HILL(14, 200, 30),
      C(-120, 70, { bank: -20 }), S(60, { bank: 0, pad: { lane: -1 } }), JUMP(22, 112), S(190), C(90, 85, { bank: 20 }),
      S(90, { bank: 0 }), LOOP(30, -44), S(90, { pad: { lane: 1 } }), C(-180, 70, { bank: -26 }), S(70, { bank: 0 }), HILL(14, 200, 30), C(120, 100, { bank: 22 }), S(120, { bank: 0 }),
      JUMP(20, 105), S(200), C(-90, 80, { bank: -20 }), S(90, { bank: 0 }), JUMP(18, 100), S(190), C(60, 100, { bank: 16 }), S(80, { bank: 0 }), LOOP(32, 46), S(110, { pad: { lane: 1 } }),
      C(100, 90, { bank: 22 }), S(160, { bank: 0 })],
  },
  tokyo: {
    name: 'Neo Tokio', tag: 'Nocne miasto: dwie pętle, wiadukty i neony', theme: 'tokyo', y0: 0,
    ops: [S(120, { pad: { lane: 1 } }), C(-60, 55, { bank: -15 }), S(60, { bank: 0 }), C(60, 55, { bank: 15 }), S(80, { bank: 0 }), HILL(12, 220, 40),
      LOOP(28, 44), S(90, { pad: { lane: -1 } }), C(90, 60, { bank: 20 }), S(40, { bank: 0 }), JUMP(20, 105), S(190), C(-150, 70, { bank: -24 }),
      S(90, { bank: 0, pad: { lane: 1 } }), C(60, 60, { bank: 16 }), S(50, { bank: 0 }), LOOP(30, -44), S(100), C(-90, 65, { bank: -20 }), S(160, { bank: 0 }),
      S(80, { pad: { lane: -1 } }), C(60, 60, { bank: 18 }), S(60, { bank: 0 }), C(-60, 60, { bank: -18 }), S(80, { bank: 0 }), HILL(14, 200, 40), S(60), LOOP(28, 44), S(90, { pad: { lane: 1 } }),
      C(150, 80, { bank: 24 }), S(70, { bank: 0 }), JUMP(20, 105), S(200), C(-120, 90, { bank: -22 }), S(90, { bank: 0 }), JUMP(22, 112), S(190), C(100, 80, { bank: 20 }), S(80, { bank: 0 }),
      LOOP(30, -46), S(150)],
  },
  alpy: {
    name: 'Przełęcz Alpejska', tag: 'Zjazd z gór: nawroty, skok nad przepaścią i pętla', theme: 'alpy', y0: 70,
    ops: [S(110, { pad: { lane: -1 } }), P(-8, 260), S(240), C(-110, 65, { bank: -22 }), S(80, { bank: 0, pad: { lane: 1 } }), C(110, 65, { bank: 22 }), S(100, { bank: 0 }),
      P(8, 260), S(60), JUMP(20, 105), S(200), LOOP(30, 42), S(90), C(180, 60, { bank: 26 }), S(70, { bank: 0 }), P(-8, 260), S(200, { pad: { lane: -1 } }), P(8, 260),
      S(80), C(-90, 75, { bank: -20 }), S(150, { bank: 0 }),
      S(60), P(-8, 260), S(200), C(130, 70, { bank: 24 }), S(70, { bank: 0, pad: { lane: -1 } }), C(-130, 70, { bank: -24 }), S(90, { bank: 0 }), P(8, 260), S(60), JUMP(22, 112), S(200),
      LOOP(30, -44), S(90, { pad: { lane: 1 } }), C(-150, 75, { bank: -24 }), S(80, { bank: 0 }), JUMP(18, 100), S(200), C(90, 90, { bank: 20 }), S(120, { bank: 0 })],
  },
  egipt: {
    name: 'Pustynia Faraonów', tag: 'Szerokie łuki, trzy duże skoki i pętla przy piramidach', theme: 'egipt', y0: 0,
    ops: [S(150, { pad: { lane: 1 } }), C(70, 120, { bank: 14 }), S(100, { bank: 0 }), JUMP(18, 100), S(190), C(-100, 110, { bank: -18 }), S(60, { bank: 0, pad: { lane: -1 } }),
      HILL(12, 200, 40), C(130, 90, { bank: 22 }), S(80, { bank: 0 }), JUMP(22, 112), S(190), C(-70, 100, { bank: -16 }), S(90, { bank: 0 }), LOOP(32, 46), S(120, { pad: { lane: 1 } }),
      C(-120, 100, { bank: -20 }), S(90, { bank: 0 }), JUMP(20, 105), S(200), C(60, 120, { bank: 12 }), S(160, { bank: 0 }),
      S(80, { pad: { lane: 1 } }), C(120, 110, { bank: 20 }), S(90, { bank: 0 }), JUMP(22, 112), S(190), C(-150, 100, { bank: -22 }), S(80, { bank: 0 }), LOOP(32, -46), S(100, { pad: { lane: -1 } }),
      C(100, 110, { bank: 18 }), S(80, { bank: 0 }), HILL(12, 200, 40), C(-120, 100, { bank: -20 }), S(90, { bank: 0 }), JUMP(20, 105), S(200), C(80, 110, { bank: 14 }), S(160, { bank: 0 })],
  },
  tropiki: {
    name: 'Wyspy Hawajskie', tag: 'Nad oceanem: pochylony nawrót, dwie pętle i skoki', theme: 'tropiki', y0: 6,
    ops: [S(120, { pad: { lane: -1 } }), C(-90, 70, { bank: -24 }), S(70, { bank: 0 }), C(90, 70, { bank: 24 }), S(90, { bank: 0 }), LOOP(30, 44), S(90, { pad: { lane: 1 } }),
      C(180, 150, { bank: 20 }), S(70, { bank: 0 }), JUMP(20, 105), S(190), C(-60, 90, { bank: -18 }), S(70, { bank: 0 }), LOOP(28, -44), S(110),
      C(-120, 75, { bank: -22 }), S(180, { bank: 0, pad: { lane: 1 } }), JUMP(22, 112), S(190), C(70, 90, { bank: 18 }), S(150, { bank: 0 }),
      S(80, { pad: { lane: -1 } }), C(90, 75, { bank: 24 }), S(80, { bank: 0 }), LOOP(30, 44), S(90, { pad: { lane: 1 } }), C(-120, 80, { bank: -22 }), S(90, { bank: 0 }), JUMP(20, 105), S(200),
      C(150, 90, { bank: 22 }), S(70, { bank: 0 }), LOOP(28, -44), S(100), C(-90, 85, { bank: -20 }), S(100, { bank: 0 }), JUMP(22, 112), S(190), C(70, 100, { bank: 16 }), S(150, { bank: 0 })],
  },
};
export const TRACK_IDS = Object.keys(TRACK_DEFS);
export const buildTrack = (id) => new Track3D({ ...TRACK_DEFS[id], id });
