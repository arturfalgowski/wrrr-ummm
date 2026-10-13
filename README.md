# Wrrr Ummm

Wyścigi w stylu TrackMania dla 1–4 graczy w przeglądarce: tory 3D z pętlami, skokami, przechyłami i padami nitro, jeden bolid F1 (zmieniasz kolor i personalizację).
Three.js (WebGL) + Node.js + Socket.IO + SQLite. Modele, tekstury, efekty i dźwięki są generowane w kodzie.

## Uruchomienie

```bash
npm install
npm start          # http://localhost:3000
```

Wymaga Node.js ≥ 22.13 (ranking używa wbudowanego `node:sqlite`). Zmienna `PORT` zmienia port. Ranking trafia do `data/ranking.db`.

## Jak grać

1. Wpisz nick, wybierz kolor bolidu i personalizację (numer, wzór lakieru, felgi, tablica).
2. **Trening solo** (z botami 0–3 i duchem rekordu) albo **Stwórz pokój** → wyślij link znajomym (link od razu wprowadza do pokoju).
3. W lobby wszyscy widzą tryb, tor, ustawienia i czat; każdy wybiera kolor i personalizację. Host może w każdej chwili zmienić tor i ustawienia i klika **Rozpocznij wyścig**.
4. Trasa jest od A do B: wygrywa najszybszy czas do mety. Spadniesz z toru — wracasz na ostatni checkpoint (klawisz **R** robi to ręcznie).

## Tory (każdy w innym kraju)

| Tor | Kraj | Atrakcje |
|---|---|---|
| Stadion Mistrzów | Polska | pętla, dwa skoki, pochylone nawroty, trybuny |
| Neo Tokio | Japonia | noc, neony, dwie pętle, skok |
| Przełęcz Alpejska | Szwajcaria | zjazd z gór, skok nad przepaścią, pętla |
| Pustynia Faraonów | Egipt | trzy duże skoki, pętla, piramidy |
| Wyspy Hawajskie | Hawaje | nad oceanem, dwie pętle, dwa skoki, zachód słońca |

Tory są budowane w `public/js/tracks3d.js` z elementów (proste, łuki z przechyłem, rampy, pętle, skoki) — `track3d.js` składa z nich trasę 3D.

## Dynamiczne otoczenie

Pora dnia przesuwa się w trakcie wyścigu (pełna doba ≈ 5 min), pogoda może się zmienić (zaczyna padać). Chmury, balony i ptaki się poruszają. Można wyłączyć w ustawieniach. W pokoju parametry losuje serwer, więc wszyscy mają to samo.

## Dynamika jazdy

Pady nitro na jednym pasie, mini-turbo po długim dryfcie (hamulec ręczny), zbiornik nitro ładujący się sam (Shift), linie prędkości i drżenie kamery przy dużej prędkości. Auto osiąga ok. 258 km/h (z nitro ok. 336 km/h).

## Sterowanie

| Klawisz | Akcja |
|---|---|
| W / ↑, S / ↓ | gaz, hamulec / wsteczny |
| A, D / ← → | skręt |
| Spacja | hamulec ręczny (drift) |
| Shift | nitro (zbiornik ładuje się sam) |
| R | powrót na ostatni checkpoint |
| C | kamera: zza auta / izometryczna |
| Enter, 1–9 | czat, szybkie reakcje |
| M | wyciszenie |
| Esc | pauza (solo) / menu (pokój) |

## Pokoje, boty, rankingi

- **Pokoje publiczne i obserwatorzy:** lista otwartych pokoi, **Szybka gra**, dołączanie do trwającego wyścigu jako widz (A/D zmienia kamerę).
- **Boty:** 0–3 botów jedzie po torze (w multiplayerze symuluje je host).
- **Powtórka:** po wyścigu odtwarza się automatycznie (można pominąć).
- **Ranking:** zwycięstwa, drugie miejsca i najlepszy czas; klik w gracza otwiera profil.
- **Czat i reakcje** w lobby i w trakcie wyścigu, dymki nad autami.
- **Muzyka** z `public/music/` (losowana, domyślnie 30%).

## Struktura

- `server.js` — pokoje, boty, ranking (SQLite), relay stanu aut.
- `public/js/track3d.js`, `tracks3d.js` — budowa i definicje torów 3D.
- `public/js/physics3d.js` — fizyka bolidu (jazda po powierzchni, grawitacja na pętlach, lot po skoku, zderzenia, bot).
- `public/js/world3d.js`, `themes3d.js` — jezdnia, bandy, bramy, pady, niebo i pora dnia, otoczenie wg kraju.
- `public/js/car.js` — model bolidu F1 i personalizacja.
- `public/js/main.js` — pętla gry, kamera, UI, multiplayer.
