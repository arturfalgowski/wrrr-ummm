# Wrrr Ummm

Wyścigi okrążeniowe dla 1–4 graczy w przeglądarce: zamknięte tory 3D z bandami na całej długości, przechyłami, padami nitro, bronią na torze (karabin, olej, miny), uszkodzeniami i jednym bolidem F1 (zmieniasz kolor i personalizację).
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
4. Tor to zamknięta pętla: liczba okrążeń (1–10, domyślnie 3) to ustawienie wyścigu. Wygrywa, kto pierwszy przejedzie ostatnie okrążenie. Bandy otaczają cały tor; klawisz **R** wraca na ostatni bezpieczny punkt.
5. **Uszkodzenia:** uderzenia w bandę, w auta, trafienia i miny zmniejszają „Stan auta”. Poniżej 60% auto dymi, poniżej 30% płonie i jest wolniejsze; przy 0% wybucha i po chwili wraca na tor. Paczka **Naprawa** dodaje 40%.

## Tory (każdy w innym kraju i o innym charakterze)

| Tor | Kraj | Długość | Charakter |
|---|---|---|---|
| Stadion Mistrzów | Polska | 2,2 km | krótki i techniczny: cztery agrafki, szykana, kostka, most |
| Neo Tokio | Japonia | 2,9 km | szybki: długa prosta, esy, tunel i wiadukt w neonowym mieście |
| Przełęcz Alpejska | Szwajcaria | 5,3 km | długi i trudny: dwa piętra serpentyn (8 agrafek), 120 m różnicy wysokości, tunele pod przełęczą |
| Pustynia Faraonów | Egipt | 4,1 km | ogromne proste (ponad 800 m) i szerokie łuki, piasek, bazar z agrafką |
| Wyspy Hawajskie | Hawaje | 3,2 km | płynny: schodkowa zatoka, plaża, esy nad oceanem, most |

Piasek i kostka mają mniejszą przyczepność (piasek dodatkowo hamuje). Teren wokół toru jest generowany: nasypy, doliny pod mostami i wzgórza nad tunelami — nic nie wchodzi na jezdnię.

Tory są zamkniętymi krzywymi (`public/js/tracks3d.js`: punkty, skala, delikatne wzniesienia); `track3d.js` składa z nich pętlę 3D z bandami i przechyłami.

## Dynamiczne otoczenie

Pora dnia przesuwa się w trakcie wyścigu (pełna doba ≈ 5 min), pogoda może się zmienić (zaczyna padać). Chmury, balony i ptaki się poruszają. Można wyłączyć w ustawieniach. W pokoju parametry losuje serwer, więc wszyscy mają to samo.

## Broń i paczki

Na torze spadają paczki: **nitro** (napełnia zbiornik), **karabin** (F: seria 4 s, trafiony rywal zwalnia i traci stan auta), **olej** (E: plama, auto traci kontrolę), **mina** (Q: wybuch podrzuca auta w promieniu 9 m i je uszkadza) i **naprawa** (+40% stanu auta). Zapasy łączą się do ×2. Ustawienia: częstość paczek (brak/rzadko/normalnie/często) i start z pełnym wyposażeniem.

## Dynamika jazdy

Pady nitro na jednym pasie, mini-turbo po długim dryfcie (hamulec ręczny), zbiornik nitro ładujący się sam (Shift), linie prędkości i drżenie kamery przy dużej prędkości. Auto osiąga ok. 258 km/h (z nitro ok. 336 km/h).

## Sterowanie

| Klawisz | Akcja |
|---|---|
| W / ↑, S / ↓ | gaz, hamulec / wsteczny |
| A, D / ← → | skręt |
| Spacja | hamulec ręczny (drift) |
| Shift | nitro (zbiornik ładuje się sam) |
| F / E / Q | karabin / olej / mina |
| R | powrót na ostatni bezpieczny punkt |
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
