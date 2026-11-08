---
name: verify-crema
description: Checks to run before calling a Crema change done. Covers tests, typecheck, the engine bundle, the tablet-fit check, a click-through of the demo at tablet and phone size, the built single-file demo, and live mode with and without the AI server. Use after any change to server/, skin/, dev/ or scripts/build-*.
---

# Verify a Crema change

Run what applies, in this order. Each command exits non-zero on failure.

1. **Server and logic**: needed for any change in `server/`, `dev/` or `test/`.
   ```bash
   npm run typecheck && npm test
   ```
   `test/flow.test.ts` starts `dev/mock-decaid.ts` on a random port and runs identify → recommend → dial-in with the mock LLM, checks 400s and the proxy, and fails if `skin/engine.js` is stale. If it is, run `npm run build:engine`.

2. **Web app syntax**: needed for any change in `skin/`.
   ```bash
   node --check skin/app.js && node --check skin/demo.js && node --check skin/engine.js
   ```

3. **Click-through**: needed for any UI change. Covers the home screen, espresso, taste feedback, steam, favourites, every view, compare, a theme switch, adding a coffee and the screen saver, at 1340×800 and 390×844.
   ```bash
   node scripts/e2e-demo.cjs --shots /tmp/crema-shots
   ```
   Look at a few of the screenshots, not just the exit code.

   For any change to machine controls (`startOp`, `stopMachine`, `renderControls`, presets, the recipe load), also run the control races: Stop during a pending settings write or recipe load, Stop while the start command is in flight, and a double tap.
   ```bash
   node scripts/e2e-controls.cjs && node scripts/e2e-controls.cjs --built
   ```
   With desktop Decaid running its simulated DE1 and serving `skin/` in live-edit mode, `node scripts/e2e-controls.cjs --url http://localhost:3000/` runs the same cases against real Decaid. It only accepts localhost; never run it against a Decaid connected to a real machine.

4. **Tablet fit**: needed for any CSS, layout or copy-length change on the Brew screen. It fails if the page or any column overflows at the DE1 tablet sizes.
   ```bash
   node scripts/check-tablet-fit.cjs /tmp/crema-fit
   ```
   It exits nonzero and lists each problem if the page scrolls in either direction, a column clips, or the page throws. Look at a screenshot or two as well.

5. **Built demo**: needed whenever the demo or its build changes.
   ```bash
   npx tsx scripts/build-demo-data.ts && node scripts/build-demo.mjs && node scripts/e2e-demo.cjs --built
   ```

6. **Live path**: needed for changes to `makeLiveApi`, connections, the engine, server routes or the proxy. It starts the simulator, serves `skin/` the way Decaid does, and checks the app with no server, with the server (mock AI), after the server stops, with AI switched off, and from a phone through the server's proxy.
   ```bash
   node scripts/e2e-live.cjs
   ```
   To poke at it by hand, run `npm run mock:decaid` and `DECAID_URL=http://localhost:8080 LLM_PROVIDERS=mock npm start`, open `http://localhost:8787`, and check `curl localhost:8080/api/v1/workflow` and `curl localhost:8080/api/v1/store/crema`.

Notes:
- Playwright is a dev dependency, so `npm install` brings it. Its Chromium needs a one-off `npx playwright install chromium`; skip that if the environment already provides a Chromium build for this Playwright version.
- CI's `ui` job runs steps 3–6 on every pull request, so a failure there means the same as a local failure.
- Bare `?demo` on a wide desktop window opens the device frame. The scripts add `&full` to test the app itself.
- When stopping background servers, kill by PID. `pkill -f <pattern>` can kill your own shell.
