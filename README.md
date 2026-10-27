# Hide & Seek — Wildlands 🌿🦁

An online 3D hide-and-seek game for 2–3 friends that runs in the browser on phones and computers.

1. Everyone joins a room with a 5-letter code.
2. Everyone rolls a die 🎲. The highest roll hides. Ties roll again.
3. The **hider** gets 75 s to run into the wild and climb into a **bush**. The **seekers** are blindfolded at camp.
4. The **seekers** then get 5 minutes to search bushes across a 2.4 × 2.4 km world. Every minute a yellow circle on the map shrinks around the hider.
5. **Wild animals** (lions, wolves, bears, crocodiles) hunt the seekers. If one mauls you, you go back to camp. **The hider is never attacked.**
6. Find the hider and the seekers win. Run out the clock and the hider wins. Scores carry over between rounds.

Tech: [Three.js](https://threejs.org) for the 3D, [Vite](https://vitejs.dev) for building, and Firebase (**Realtime Database + Anonymous Auth + Hosting**, all on the free *Spark* plan, no credit card needed).

---

## World

| Region | Look | Danger |
|---|---|---|
| ⛺ Base Camp Meadow (centre) | Flat meadow, oaks, a few starter bushes | Safe |
| 🌾 Golden Savanna (south-east) | Golden grass, acacias, rocky outcrops | Lions |
| 🌲 Whispering Forest (south-west) | Dense pines and oaks, lots of bushes | Wolves |
| 🏔 Stonepeak Highlands (north-west) | Ridged mountains, boulders, snow caps | Bears |
| 🐊 Murkwater Swamp (north-east) | Pools, mangrove-like trees | Crocodiles |

The whole world is generated from a seed in `src/config.js`, so every player gets the same trees and bushes without downloading anything. Graphics use physically based materials, sky lighting, real-time shadows, fog, swaying foliage and grass.

## Controls

| | Computer | Phone / tablet |
|---|---|---|
| Move | WASD / arrow keys | Left thumb (a joystick appears where you touch) |
| Look | Mouse (click the game to lock the pointer, Esc to release) | Drag with your right thumb |
| Run | Shift | **Run** button (or push the stick far) |
| Jump | Space | **Jump** button |
| Hide / Search / Tag | E | Yellow action button |
| Zoom | Mouse wheel | – |
| Map | M, or click the map | Tap the map |

---

## 1. Run it on your computer (no Firebase needed)

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Open the URL it prints (usually http://localhost:5173).

Without a Firebase config the game starts in **🧪 Local test mode**. Every browser tab on the same computer shares one pretend server, so you can test multiplayer by yourself:

1. Tab 1: enter a name, **Create a room**, then **Copy invite link**.
2. Tabs 2 and 3: paste the link and press **Join**.
3. Tab 1 (the host): **Start game**, then everyone rolls.

Handy URL options for testing:

| Option | What it does |
|---|---|
| `?hide=10&seek=60` | Short rounds (adds the times to the host's dropdowns) |
| `?min=1` | Lets you start a round alone |
| `?q=low` / `?q=high` | Forces graphics quality (phones default to low) |
| `?debug` | FPS / draw-call counter, and `window.__game` in the console |
| `?local` | Forces local mode even when Firebase is configured |

To test on your phone over Wi-Fi, `npm run dev` also prints a `Network:` URL. Local mode only connects tabs **on the same device**, so phone ↔ computer play needs Firebase (step 2).

## 2. Set up Firebase (free) so friends anywhere can join

1. Go to <https://console.firebase.google.com>, click **Add project**, and give it a name (for example `wildlands-hide-seek`). Google Analytics is optional; you can turn it off.
2. **Add a web app.** On the project overview click the `</>` (Web) icon and register an app. You do *not* need to tick "Firebase Hosting" here. Firebase then shows a `firebaseConfig` object. Keep that page open.
3. **Turn on Anonymous sign-in.** Go to *Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save*.
4. **Create the Realtime Database.** Go to *Build → Realtime Database → Create database*, pick the location closest to your group, and choose **Start in locked mode**. The rules in this repo get deployed in step 3 below.
5. **Paste your config.** In the project folder:
   ```bash
   cp .env.example .env.local
   ```
   Fill in `.env.local` from the `firebaseConfig` object:
   ```
   VITE_FIREBASE_API_KEY=AIza...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
   VITE_FIREBASE_PROJECT_ID=your-project
   VITE_FIREBASE_APP_ID=1:123:web:abc
   ```
   If `databaseURL` is missing from the snippet, copy it from the top of the Realtime Database page. It may end in `.firebasedatabase.app` if you picked a region outside the US.
   These web keys are not secret; the database rules control access. `.env.local` is git-ignored anyway.
6. Restart `npm run dev`. The menu should now say **🌍 Online mode**.

## 3. Deploy to Firebase Hosting (free)

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # pick your project, alias "default"
npm run deploy                # = vite build + firebase deploy --only hosting,database
```

The deploy step uploads `dist/` to Hosting and publishes `database.rules.json`. You get a URL like `https://your-project.web.app`. Send it to your friends: one person creates a room and shares the invite link (`…/?room=ABCDE`).

To deploy only the website or only the rules: `firebase deploy --only hosting` or `firebase deploy --only database`.

### Staying inside the free plan

The Spark plan limits below are from when this was written; check <https://firebase.google.com/pricing> for current numbers.

* **Hosting:** about 10 GB storage and 360 MB/day transfer. The whole game is about 235 KB gzipped, so that is well over 1,000 visits a day.
* **Realtime Database:** 100 simultaneous connections, 1 GB stored, 10 GB/month downloaded. Each player sends a small position update 10 times a second only while moving. A 3-player game uses roughly 30–40 MB per hour, so you get hundreds of hours a month.
* On Spark you can't be charged. If a limit is hit, the service pauses until the next day or month.

### Security rules (`database.rules.json`)

* Only signed-in (anonymous) users can read rooms.
* Anyone can create a room code that is free. Only players inside a room can change its game state.
* Each player can write only their own player entry. Names and colours are validated.
* There is no game server, so a tech-savvy friend could cheat with the browser console, for example by reading the hider's bush. This is a game for friends; see the roadmap for a Cloud Functions referee.

---

## Project layout

```
index.html                 UI screens (menu, lobby, dice, HUD, touch buttons)
src/main.js                Boot: renderer, world, backend selection, menu wiring, main loop
src/config.js              ⚙️ All tuning: world size/seed, timers, speeds, ranges
src/world/
  terrain.js               Height field from blended per-region noise + terrain mesh
  regions.js               Region definitions (colours, plants, animals) + blending
  vegetation.js            Tree/bush/rock placement, chunking, LOD, collisions, bush ids
  models.js                Procedural tree/bush/rock geometry
  grass.js                 Grass field that follows the player
  world.js                 Sky, sun + shadows, image-based lighting, fog, water
  noise.js, rng.js         Seeded simplex noise + deterministic random
  textures.js, materials.js Procedural textures, wind-sway foliage shader
src/entities/
  character.js             Procedural explorer with walk/run/jump/crouch animation
  animals.js               Lions, wolves, bears, crocodiles: models + hunting AI
src/game/
  game.js                  Gameplay: phases, hiding, searching, tagging, damage, hints, HUD
  controls.js              Keyboard/mouse + virtual joystick
  camera.js                Third-person camera with terrain collision
src/net/
  room.js                  Room + phase state machine (transactions, no server needed)
  firebase-backend.js      Realtime Database + Anonymous Auth adapter
  local-backend.js         Offline multi-tab adapter (BroadcastChannel)
src/ui/                    DOM helpers, CSS 3D dice, minimap
firebase.json              Hosting + database config
database.rules.json        Realtime Database security rules
```

### How multiplayer works

* `rooms/{CODE}/players/{uid}` holds each player's name, colour, latest pose (`s`), dice roll and hidden bush.
* `rooms/{CODE}/state` holds the phase (`lobby → dice → hiding → seeking → ended`), timers, the hider and scores. Any client can advance the phase when its condition is met, for example when the timer expires or all dice are rolled. A **transaction** makes sure it happens exactly once.
* Timers use Firebase's server clock offset, so all devices agree.
* Every client runs the animals with the same seed and the same synced player positions, so wildlife costs no network traffic. A bite only counts on the victim's own device.
* Bushes have stable ids because the world is deterministic. The hider stores the id of their bush, and a seeker's search compares against it.

## Roadmap / next steps

The prototype is fully playable. Possible next steps:

1. **Real 3D models.** Swap the procedural characters/animals for rigged glTF models, for example from Quaternius, Kenney or Sketchfab (CC0/CC-BY). `Character` and `buildModel()` are the places to plug in a `GLTFLoader`.
2. **Sound.** Ambient region loops, footsteps, roars when an animal starts chasing, a rustle when someone searches a bush.
3. **More regions/animals.** Add an entry to `REGIONS` and a species to `SPECIES` (hyenas, rhinos, snakes).
4. **Hider abilities.** A one-time decoy rustle, or switching bushes while seekers are far away.
5. **Day/night cycle**, plus rain in the forest.
6. **Server referee.** A Cloud Function that keeps the hider's bush secret and validates "found". This needs the Blaze plan, which has a free tier but requires a card.
7. **PWA install.** A manifest + service worker so it installs like an app on phones.
