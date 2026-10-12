# Wrrr Ummm

Wyścigi 3D dla dwóch graczy w przeglądarce. Three.js (WebGL) + Node.js + Socket.IO + SQLite.
Wszystkie modele, tekstury, efekty i dźwięki są generowane w kodzie — brak zewnętrznych plików graficznych i audio.

## Uruchomienie

```bash
npm install
npm start          # http://localhost:3000
```

Wymaga Node.js ≥ 22.13 (ranking używa wbudowanego `node:sqlite`, bez natywnych zależności).
Zmienna `PORT` zmienia port. Ranking trafia do `data/ranking.db`.

## Jak grać

1. Wpisz nick (zapamiętany w LocalStorage), wybierz auto.
2. **Stwórz wyścig** → skopiuj link i wyślij drugiemu graczowi. Po otwarciu linku wybiera auto i dołącza.
3. Gdy obaj klikną **Gotowy** — odliczanie i start. 4 okrążenia, wygrywa pierwszy na mecie. **Rewanż** w oknie wyników.
4. **Trening solo** — jazda bez przeciwnika.

Aby zagrać z kimś w sieci, serwer musi być dostępny pod adresem, który otworzy drugi gracz
(adres LAN, np. `http://192.168.0.10:3000`, albo wdrożenie na serwerze). Link w lobby jest budowany z adresu, pod którym otwarto grę.

## Sterowanie

| Klawisz | Akcja |
|---|---|
| W / ↑ | gaz |
| S / ↓ | hamulec / wsteczny |
| A, D / ← → | skręt |
| Spacja | hamulec ręczny (drift) |
| M | wyciszenie |

## Architektura

```
server.js            Express + Socket.IO: pokoje, odliczanie, wynik, ranking (SQLite)
public/index.html    UI (nick, menu, lobby, HUD, wyniki)
public/js/main.js    pętla gry, kamera izometryczna (auto-dopasowana do toru), sieć, UI
public/js/track.js   oś toru, próbkowanie, zapytania o pozycję (postęp, odległość boczna)
public/js/physics.js fizyka arcade: napęd, drift, bariery, zderzenia aut
public/js/car.js     proceduralne auta (wyciągnięty profil + shader lakieru/pasów GLSL)
public/js/world.js   asfalt, krawężniki, bariery, trybuny, drzewa, billboardy
public/js/post.js    tilt-shift + winieta (GLSL)
public/js/fx.js      cząsteczki (dym/kurz/iskry) i ślady opon
public/js/audio.js   Web Audio: silnik zależny od obrotów, opony, kolizje, sygnały, UI
```

**Sieć.** Każdy klient symuluje własne auto i wysyła jego stan ~30 razy/s; serwer przekazuje go przeciwnikowi
(interpolacja z buforem 110 ms). Kolizje aut liczy każdy klient po swojej stronie. Serwer jest autorytetem dla
pokoi, odliczania, kolejności mety i rankingu — nie waliduje fizyki, więc nie jest odporny na oszustwa.

**WebGPU.** Nie użyte — renderer to WebGL (stabilny i szeroko wspierany), zgodnie z założeniem „WebGPU opcjonalnie".
