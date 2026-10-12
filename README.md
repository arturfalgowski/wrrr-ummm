# Wrrr Ummm

Wyścigi 3D dla 2–4 graczy w przeglądarce. Three.js (WebGL) + Node.js + Socket.IO + SQLite.
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
2. **Stwórz wyścig** → skopiuj link i wyślij go znajomym (do 4 graczy w pokoju). Po otwarciu linku wybierają auto i dołączają.
3. Host wybiera tor w lobby (5 torów, każdy z innymi atrakcjami: Dolina Sosen (hopka, kałuża), Pustynny Owal (dwie hopki), Zimowa Serpentyna (lodowe plamy), Jesienna Pętla (deszcz, ósemka z mostem, kałuże), Nadmorski Wir (most nad lagunią, hopka, kałuża)). Gdy wszyscy w pokoju (min. 2) klikną **Gotowy** — odliczanie i start. Wygrywa pierwszy na mecie. **Rewanż** w oknie wyników.
4. **Trening solo** — jazda bez przeciwnika, opcjonalnie z **duchem** swojego najlepszego okrążenia (zapisywany w przeglądarce osobno dla każdego toru).

W trakcie jazdy w rogu ekranu jest **minimapa**: zarys toru, pozycje wszystkich graczy (kolor auta + pierwsza litera nicku), paczki i duch.

Aby zagrać z kimś w sieci, serwer musi być dostępny pod adresem, który otworzy drugi gracz
(adres LAN, np. `http://192.168.0.10:3000`, albo wdrożenie na serwerze). Link w lobby jest budowany z adresu, pod którym otwarto grę.

## Turniej, boty, pogoda, personalizacja

- **Turniej:** opcja w ustawieniach wyścigu — seria 3 wyścigów, punkty 10-6-4-2, po każdej rundzie klasyfikacja; tor kolejnej rundy wybiera host (w solo — Ty). Po trzeciej rundzie ogłaszany jest mistrz.
- **Boty w wyścigu:** 0–3 botów jedzie po torze (w solo i w pokoju; w multiplayerze symuluje je host). Biorą udział w klasyfikacji i punktach.
- **Pogoda i pora dnia:** deszcz i burza (mokry asfalt, mniejsza przyczepność, błyski i grzmoty), zmierzch i noc z reflektorami aut i światłami przy bandzie. Opcja *Losowo* losuje na każdy wyścig; w pokoju losuje serwer, więc wszyscy mają to samo.
- **Personalizacja aut:** numer startowy 1–99, wzór lakieru (pasy / płomienie / szachownica / brak), 4 style felg i kolor felg, tablica z nickiem. Widoczne dla wszystkich graczy.
- **Pokoje publiczne i obserwatorzy:** lista otwartych pokoi („Pokoje publiczne”), **Szybka gra**, a do trwającego wyścigu można dołączyć jako widz (A/D zmienia kamerę). Host może ukryć pokój z listy.
- **Powtórka:** po wyścigu przycisk **Powtórka** odtwarza ostatnie ~12 s w zwolnionym tempie z kamerami: pościg, z góry, z boku.
- **Rankingi:** osobne dla wyścigów i areny, klik w gracza otwiera profil (zwycięstwa, drugie miejsca, skuteczność, najlepszy czas).
- **Dźwięk:** kolizje zależne od materiału (bariera, auto, słup, opony, lądowanie, kałuża) i osobne dźwięki zebrania każdej paczki.

## Czat i reakcje

**Enter** otwiera czat (Enter wysyła, Esc zamyka), klawisze **1–9** wysyłają szybkie reakcje (GG!, Dobra jazda!, Uważaj!, Haha, Nie ze mną!, Pomocy!, Rewanż?, Ale numer!, Do mety!).
Wiadomości i reakcje pojawiają się też jako dymki nad autami. Na ekranie wyników widać, kto kliknął **Rewanż** i na kogo jeszcze czekamy.

## Muzyka

Utwory z `public/music/` (mp3) losują się na starcie menu i każdego poziomu; domyślna głośność 30%. Przycisk nutki w rogu włącza/wyłącza muzykę (najechanie pokazuje suwak głośności). Dodanie nowego pliku do folderu wystarczy — lista jest czytana z serwera.

## Sterowanie

| Klawisz | Akcja |
|---|---|
| W / ↑ | gaz |
| S / ↓ | hamulec / wsteczny |
| A, D / ← → | skręt |
| Spacja | hamulec ręczny (drift) |
| Shift | nitro (2,5 s) |
| F | karabin: seria przez 4 s (naboje trzymasz do dowolnej chwili) |
| E | zrzut plamy oleju |
| R | (arena) karabin: seria 2 s, ładuje się sam co 6 s |
| Q | mina (w wyścigu; na arenie w pełnym zestawie) |
| T / G | (arena, pełny zestaw) rakieta / tarcza |
| M | wyciszenie |

## Arena (tryb walki)

Drugi tryb: nie ścigamy się, tylko walczymy. Okrągła arena z górkami, dołami, rampami do skoków, centralną platformą i słupami-osłonami.
Wygrywa ostatni żywy — 0% wytrzymałości oznacza eliminację bez odradzania (wyeliminowany ogląda dalej, A/D zmienia kamerę).
Na arenę spadają paczki z bronią; masz **jeden slot na broń** (nowa zastępuje starą), używasz jej klawiszem **F**:
bomba (mina za autem), rakieta (naprowadzana na najbliższego), karabin (seria 4 s), tarcza (5 s), olej. Do tego nitro (Shift) i naprawa.
Tryb wybierasz w menu (host w lobby); solo gra się z 1–3 botami.

## Wyposażenie startowe

W ustawieniach (menu, a w multiplayerze host w lobby) opcja **Start z wyposażeniem**: *Standardowy* albo *Pełny*. W wyścigu pełny zestaw to nitro, olej, karabin i mina; na arenie nitro oraz osobne zapasy rakiety, miny, tarczy i oleju (Q/E/T/G) obok slotu F i karabinu na R. Miny są też w paczkach (w wyścigu — Q).

## Paczki

Na tor spadają (niezbyt często) paczki: **nitro**, **naboje** i **olej**. Naboje zbierasz i używasz kiedy chcesz — F uruchamia 4-sekundową serię z karabinu; każde trafienie zwalnia rywala.
Plama oleju odbiera przyczepność każdemu, kto w nią wjedzie — także temu, kto ją zrzucił.
**Zniszczenia:** auto ma wytrzymałość 0–100% (pasek w HUD i nad autami). Traci ją przy uderzeniach w bandę i opony, zderzeniach z autami oraz trafieniach z karabinu. Uszkodzone auto jest wolniejsze, ściąga na bok, wgniata się, ciemnieje i dymi (poniżej ~22% płonie). Przy 0% wybucha i po 3 s odradza się na torze z pełną wytrzymałością (2 s nietykalności). Paczka **naprawa** (zielony plus) przywraca 40%.

Stosy opon przy bandzie rozlatują się po uderzeniu (i lekko zwalniają auto).

## Architektura

```
server.js            Express + Socket.IO: pokoje, odliczanie, wynik, ranking (SQLite)
public/index.html    UI (nick, menu, lobby, HUD, wyniki)
public/js/main.js    pętla gry, kamera izometryczna (auto-dopasowana do toru), sieć, UI
public/js/minimap.js minimapa w HUD
public/js/arena.js    teren areny i fizyka (skoki, zbocza), arenaworld.js — jej wygląd
public/js/items.js   paczki, pociski, plamy oleju
public/js/tires.js   rozbijane opony
public/js/track.js   definicje 3 torów, oś toru, próbkowanie, zapytania o pozycję (postęp, odległość boczna)
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
