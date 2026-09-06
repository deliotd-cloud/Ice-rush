# Dante: Ice Rush

A playable 3D short-track speed skating game for PC browsers, featuring Dante, Nova and Kai.

## Play

**[Play Ice Rush in your browser](https://deliotd-cloud.github.io/Ice-rush/)**

Choose a skater and race three laps against three opponents. The game includes generated character artwork, animated 3D skaters, a cheering crowd, a chase camera and a personal-best timer saved on your device.

Use a desktop browser with WebGL enabled and a keyboard. No account, API key or game installation is needed for the hosted version.

## Controls

| Key | Action |
| --- | --- |
| 1 / 2 / 3 | Select Dante / Nova / Kai before racing |
| Enter | Start or race again |
| A / D, alternating | Build stride rhythm and speed |
| Up / Down arrows | Change racing line |
| Space | Boost while stamina is available |

The character cards and start button also work with the mouse. After finishing, choose **Choose character** to switch skaters.

## Run on your PC

Install Node.js 24, then run:

```sh
git clone https://github.com/deliotd-cloud/Ice-rush.git
cd Ice-rush
npm ci
npm run dev
```

Open the local address printed in the terminal. To check the production build:

```sh
npm test
npm run build
npm run preview
```

Do not open `index.html` directly from the file manager; use the local server or the hosted game link.

## Publishing

The GitHub Actions workflow tests and builds the game, then publishes `dist/` to GitHub Pages whenever `main` changes. Pages must use **GitHub Actions** as its publishing source.

This is a self-contained browser version of the game. It does not depend on the original private hosting service, server credentials or external image/font services. The generated character art is included in `public/`; original family photographs are not included.
