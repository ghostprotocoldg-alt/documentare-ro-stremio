# Documentare RO Oficiale — addon Stremio

Addon personal pentru Stremio care adună documentare gratuite din surse oficiale:

- **ARTE.tv Documentare** — conținut publicat pe canalul oficial în limba română.
- **National Geographic România** — playlist oficial cu documentare integrale, subtitrate în română.

## Instalare

După ce workflow-ul GitHub generează ramura `static`, manifestul este disponibil la:

https://raw.githubusercontent.com/ghostprotocoldg-alt/documentare-ro-stremio/static/manifest.json

Copiază adresa în Stremio la **Add-ons → Add addon / Install via URL**.

## Cum funcționează

GitHub Actions citește periodic feed-urile YouTube oficiale și generează răspunsurile JSON necesare protocolului Stremio pentru catalog, meta și stream. Redarea folosește ID-urile YouTube oficiale, fără a reîncărca sau redistribui fișiere video.

Actualizarea automată rulează la fiecare 6 ore.
