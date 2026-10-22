# Voxel Drive: Infinite Horizon

![Voxel Drive: Infinite Horizon](screenshot.png)

Gioco arcade di guida **open-world voxel** in un unico file HTML, con Three.js. Città, autostrada, colline, traffico, drift, parcheggi e off-road. Tre auto selezionabili, cambio automatico o manuale e controlli touch per Android. Installabile come PWA.

**▶ Gioca ora:** <https://giuseppelia890-tech.github.io/voxel-drive/>

---

## Caratteristiche

- **Mondo aperto** 1200 × 1200 con autostrada a 4 corsie, città con edifici e colline percorribili.
- **3 auto** con fisica e modello dedicati:
  - **Citycar** — agile e facile;
  - **Supercar** — velocità e tenuta massime;
  - **Pick-up 4x4** — il re dell'off-road.
- **Cambio automatico a 6 marce** oppure **manuale** (Q/E su desktop, tasti `+` / `−` su touch).
- **Traffico vivo** con auto che percorrono autostrada e strade cittadine (28 veicoli su desktop, 16 su mobile).
- **Drift scoring** con combo e moltiplicatore.
- **3 parcheggi** con allineamento preciso, progresso e contatore `P x/3`.
- **Timer 0–100 km/h** e velocità massima per ogni auto.
- **Off-road** con aderenza ridotta e sospensioni a 4 punti.
- **Audio procedurale** (motore, drift, avvisi) generato con Web Audio API, senza file audio.
- **HUD responsive**, menu di avvio, pausa, selezione auto e camera.
- **Android**: controlli touch multi-touch, fullscreen, blocco landscape, safe-area per notch, wake lock.
- **PWA installabile**: manifest, service worker, icone 192/512 e cache offline.

## Controlli

### Desktop

| Azione | Tasto |
|---|---|
| Sterzo | `A` / `D` oppure `←` / `→` |
| Acceleratore | `W` / `↑` |
| Freno / retromarcia | `S` / `↓` |
| Freno a mano / drift | `Spazio` |
| Cambio su / giù (manuale) | `E` / `Q` |
| Attiva/disattiva cambio manuale | `M` |
| Camera | `C` |
| Pausa | `P` / `Esc` |
| Reset auto | `R` |

### Touch (Android)

- **Frecce** in basso a sinistra: sterzo.
- **▲** a destra: acceleratore.
- **▼** a destra: freno / retromarcia.
- **DRIFT**: freno a mano.
- **+ / −**: marce, visibili in modalità manuale.
- **Pulsanti in alto a destra**: audio, camera, pausa, fullscreen.
- **CAMBIO** nel pannello velocità: passa tra automatico e manuale.

## Installazione su Android

1. Apri la [demo live](https://giuseppelia890-tech.github.io/voxel-drive/) con **Chrome**.
2. Tocca il menu `⋮` → **Installa app** / **Aggiungi a schermata Home**.
   In alternativa, usa il pulsante **INSTALLA APP** nel menu del gioco quando disponibile.
3. Avvia l'icona: il gioco parte in landscape e fullscreen.

> Il service worker richiede HTTP/HTTPS: da `file://` il gioco funziona, ma la cache offline e l'installazione PWA no.

## Tecnologia

- **Three.js r128** (CDN Cloudflare) per la scena 3D.
- **WebGL** con rendering voxel low-poly, ombre, tone mapping ACES e quality adattiva.
- **Web Audio API** per motore, drift e feedback sonori procedurali.
- **JavaScript vanilla**, nessun bundler e nessuna dipendenza oltre a Three.js.
- **PWA** con `manifest.webmanifest` + `sw.js` e cache offline.

## Struttura del progetto

```
.
├── index.html            # gioco completo (HTML + CSS + JS)
├── manifest.webmanifest  # manifest PWA
├── sw.js                 # service worker (cache offline)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon.html         # sorgente dell'icona
├── screenshot.png
├── .nojekyll
└── README.md
```

## Sviluppo locale

Serve un server HTTP statico (per il service worker):

```bash
python3 -m http.server 8123
# poi apri http://localhost:8123
```

Per provare la UI touch da desktop, aggiungi `?touch=1` all'URL.

## Note

- La cache offline si aggiorna al reload; per forzare un aggiornamento dopo una modifica, incrementa `CACHE` in `sw.js`.
- I punti drift e i parcheggi completati restano per la sessione; il reset auto non cancella i progressi dei parcheggi.
- Le impostazioni audio vengono salvate in `localStorage`.

---

Progetto personale — Voxel Drive: Infinite Horizon.
