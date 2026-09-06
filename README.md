# Dante: Ice Rush

A playable 3D short-track speed skating game for PC browsers, featuring Dante, Nova and Kai.

## Play

**[Play Ice Rush in your browser](https://deliotd-cloud.github.io/Ice-rush/)**

Choose Dante, Nova or Kai and race three laps. Pack racing offers Rookie, Club and Elite rivals who choose passing lines and fight for position. Draft behind another skater to recover energy, then move out and boost past. Time Trial saves your fastest run locally as a translucent ghost for your next attempt.

Detailed slim skaters feature continuous skinned joints, woven suits, helmet seams and uncovered steel blades. The rink includes reflective ice, blade trails, spray and a cheering crowd. Switch between chase and tactical cameras, or select Balanced graphics for lighter rendering. Race results show lap splits, perfect strides and your best combo. Procedural skating, wind and race sounds need no external audio files.

Use a desktop browser with WebGL enabled and a keyboard. No account, API key or game installation is needed for the hosted version.

## Controls

| Key | Action |
| --- | --- |
| 1 / 2 / 3 | Select Dante / Nova / Kai before racing |
| Enter | Start or race again |
| W (hold) | Assisted skating — an easy way to learn |
| A / D, alternating | Build stride rhythm and speed |
| Up / Down arrows | Change racing line |
| Space | Boost while stamina is available |
| Escape / P | Pause or resume (switching away also pauses) |
| C | Chase / tactical camera |
| M | Mute / unmute sound |

The control deck also supports mouse/pointer skating, steering and boost. Standard-mapped gamepads support A to skate, RT to boost, left stick to steer, LB/RB for manual strides, Y for camera and Start for pause. Physical controller testing is still recommended for your particular device.

Alternate A/D about every 0.38 seconds: the bright timing zone rewards precise strides with extra speed and energy. Rapid key spam does not help. Exhausting boost locks it until energy recovers to 28%. Records and ghosts are stored only in your browser; clearing site data removes them.

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
