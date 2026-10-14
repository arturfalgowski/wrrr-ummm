# Wrrr Ummm — notatki projektu

Polska przeglądarkowa gra wyścigowa (okrążenia, 1–4 graczy + boty). Three.js + Node + Socket.IO + SQLite (`node:sqlite`, Node ≥ 22.13 lokalnie; na VPS Node 24 z `/opt/node24`).
Repo: https://github.com/arturfalgowski/wrrr-ummm (gałąź `main`). Użytkownik pisze po polsku; w UI bez emoji (SVG); komentarze po polsku.

## Uruchomienie lokalne

```bash
npm install
PORT=3471 node server.js     # http://localhost:3471  (3000 domyślnie)
```
Debug w konsoli przeglądarki: `window.__tc` = { S, me, opps, items, track, world, camera, scene, startSolo, finishLocal, free, ... }.
`__tc.me.auto = true` — autopilot (bot) dla testów; `__tc.free = {p:[x,y,z], l:[x,y,z]}` — wolna kamera.
Panel przeglądarki (Claude) rysuje klatki tylko gdy jest widoczny: przed długim czekaniem zrób screenshot/wait. Moduły JS mogą się cache'ować — po zmianie `location.reload()`.

## Wdrożenie (VPS)

- Serwer: `ssh ubuntu@51.195.41.0` (klucz w `~/.ssh`, bez hasła). Współdzielony z innymi projektami (CarShot, Garmin) — nie ruszaj ich.
- Katalog: `/var/www/wrrr-ummm` (bez gita na serwerze), usługa systemd `wrrr-ummm` (`PORT=3470 HOST=127.0.0.1`, `/opt/node24/bin/node`, `Restart=always`).
- nginx: `/etc/nginx/sites-enabled/qrfa.pl`, `location /wrrr/` → `127.0.0.1:3470` (WebSocket). Adres publiczny: **https://qrfa.pl/wrrr/**.
- Ranking: `data/ranking.db` na serwerze (NIE nadpisuj — paczka musi go pomijać).

Wdrożenie (z katalogu projektu):
```bash
git add -A && git commit -m "..." && git push        # commit kończ linią: Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
tar czf /tmp/w.tgz --exclude=node_modules --exclude=data --exclude=.git .
scp /tmp/w.tgz ubuntu@51.195.41.0:/tmp/w.tgz
ssh ubuntu@51.195.41.0 'cd /var/www/wrrr-ummm && sudo tar xzf /tmp/w.tgz; sudo systemctl restart wrrr-ummm; systemctl is-active wrrr-ummm'
md5 -q public/js/main.js        # porównaj z: ssh ... md5sum public/js/main.js
```
Po usunięciu/zmianie nazw plików skasuj stare ręcznie na VPS (tar tylko dopisuje). Przy `npm install` nowych zależności: `ssh ... 'cd /var/www/wrrr-ummm && npm install --omit=dev'`.
Logi: `ssh ubuntu@51.195.41.0 'journalctl -u wrrr-ummm -n 50 --no-pager'`.

## Architektura

- `server.js` — pokoje (≤4 ludzi + boty), lobby, start wyścigu (host), boty liczy host, relay stanu aut (`race:state`, `race:bots`), paczki (`pickup:*`), zdarzenia broni (`game:event`), ranking (SQLite), czat. Ustawienia (`cleanSettings`): laps (1–10, domyślnie 3), bots, public, weather, time, dyn, pickups, loadout. `TRACKS` = stadion, jesien, alpy, egipt, tropiki.
- `public/js/track3d.js` — `Track3D`: tor to ZAMKNIĘTA pętla z krzywej Catmull-Rom (`def.points`, `scale`, `startAt`, `elev` = profil wysokości [ułamek okrążenia, m] (stare `hills` = sinusy), `maxBank`, `zones`). Próbki co 1 m (`DS`), ramka T/U/R, przechył, krzywizny `kg`/`ku`, `at(s)`, `pos(s,d,h)`, `nearest()`, wszystko modulo długości okrążenia. Pady nitro, `lastCp(s)` (respawn), strefy: kostka/piasek (`zone`, `gripArr`), `bridges`. Szerokość zmienna: `hwArr[i]` (połowa szerokości), `at().hw`, `hwAt(s)`; domyślnie 12 (tor 24 m), zwężenia do 8 i poszerzenia do 15 w `def.width = [[a,b,hw],…]`. `HW`=8 to tylko najwęższy wariant — w kodzie używaj `hw` z `at()`.
- `public/js/tracks3d.js` — definicje 5 torów (punkty składane z prostych i łuków `arc(cx,cz,r,a0,a1)` o znanych promieniach, `startAt`, `elev`, strefy `{a,b,type: cobble|sand|bridge}` jako ułamki okrążenia).
- `public/js/physics3d.js` — `CarState`: jazda we współrzędnych toru (s wzdłuż, d w poprzek, phi kurs), bandy zawsze (|d|≤HW−1), niewidzialna ściana w powietrzu, `knock` (mina), `respawnAt`, `carVsCar`, `botInput`. Przyczepność z `track.at().grip`, piasek dodatkowo hamuje.
- `public/js/world3d.js` — świat: niebo (pora dnia), teren z mapy wysokości (nasypy, doliny pod mostami, `world.hAt`), nawierzchnie (asfalt/kostka/piasek), bandy, kerby, pady, brama START/META (s=0), mosty (dźwigary+filary), dekoracje motywu, chmury/balony/ptaki.
- `public/js/themes3d.js` — motywy krajów (kolory, `relief`, `groundBelow`, dekoracje: sosny, palmy, skały, góry, trybuny, drapacze, piramidy…). Duże obiekty tła sprawdzają `farDist` (nie wchodzą na tor); obiekty stoją na `hAt`.
- `public/js/main.js` — pętla gry, UI (menu/lobby/wyniki), kamera, HUD, multiplayer, okrążenia (`S.raceLaps`, `me.lapIdx`), uszkodzenia (`me.hp`, `damageMe`, wybuch, respawn po 2,6 s), paczki (nitro, karabin, olej, mina, naprawa), duch rekordu (`tc_ghost4_<tor>_<okr>`), powtórka.
- `items3d.js` (paczki/miny/olej/pociski w współrzędnych toru, odległości modulo okrążenie), `car.js` (bolid F1, kolor, personalizacja, wgniecenia `setDamage`), `fx.js`, `minimap.js`, `post.js`, `audio.js`, `music.js`.

## Konwencje i pułapki

- Postęp `s` jest ciągły (nie zawija się): okrążenie = `floor(s/L)`, meta po `s ≥ laps·L`, start na polach o ujemnym `s` (−6, −13, −20, −27).
- Pakiet stanu (23 liczby): 0 x,1 z,2 yaw,3 vx,4 vz,5 steer,6 vf,7 vl,8 s,9 throttle,10 hamulec,11 0,12 meta,13 nitro,14 ręczny,15 hp,16 dead,17 y,18 0,19 d,20 phi,21 w powietrzu,22 vy. Serwer waliduje 22–26 liczb skończonych.
- Zdarzenia broni (`shoot/oil/bomb/boom/hit`) używają x=s, z=d.
- Nowy tor: dodaj do `TRACK_DEFS` i `TRACKS` w server.js; sprawdź `minR ≥ ~27 m`, brak samoprzecięć, bot przejeżdża 3 okrążenia bez wypadnięcia (skrypty testowe były w scratchpadzie, np. symulacja `CarState`+`botInput` w Node).
- Strefy mostu ≥ ~180 m; nie na starcie (0–0,1 okrążenia). Tuneli w grze nie ma.
- Tło: tory mają być czytelne (ważniejsze niż pole obok) — nawierzchnia musi kontrastować z terenem (piasek na pustyni jest ciemnobrązowy).
- Użytkownik woli: pytanie przez AskUserQuestion przy niejasnościach, uczciwe raportowanie, sprawdzanie w przeglądarce przed wdrożeniem.
