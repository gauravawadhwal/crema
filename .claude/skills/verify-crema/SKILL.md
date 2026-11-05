---
name: verify-crema
description: Checks to run before calling a Crema change done. Covers tests, typecheck, the tablet-fit check, a click-through of the demo at tablet and phone size, and the built single-file demo. Use after any change to server/, skin/, dev/ or scripts/build-*.
---

# Verify a Crema change

Run what applies, in this order. Each command exits non-zero on failure.

1. **Server and logic**: needed for any change in `server/`, `dev/` or `test/`.
   ```bash
   npm run typecheck && npm test
   ```
   `test/flow.test.ts` starts `dev/mock-decaid.ts` on a random port and runs identify → save → recommend → apply → shot → feedback with the mock LLM.

2. **Web app syntax**: needed for any change in `skin/`.
   ```bash
   node --check skin/app.js && node --check skin/demo.js
   ```

3. **Click-through**: needed for any UI change. Covers the home screen, espresso, taste feedback, steam, favourites, every view, compare, a theme switch, adding a coffee and the screen saver, at 1340×800 and 390×844.
   ```bash
   node scripts/e2e-demo.cjs --shots /tmp/crema-shots
   ```
   Look at a few of the screenshots, not just the exit code.

4. **Tablet fit**: needed for any CSS, layout or copy-length change on the Brew screen. It fails if the page or any column overflows at the DE1 tablet sizes.
   ```bash
   node scripts/check-tablet-fit.cjs /tmp/crema-fit
   ```
   Expect five "fits" lines and no "CLIPPED".

5. **Built demo**: needed whenever the demo or its build changes.
   ```bash
   npx tsx scripts/build-demo-data.ts && node scripts/build-demo.mjs && node scripts/e2e-demo.cjs --built
   ```

6. **Live path**: needed for changes to `makeLiveApi`, server routes or the proxy. Run the server and simulator, then use the app at `http://localhost:8787`.
   ```bash
   npm run mock:decaid
   ```
   ```bash
   LLM_PROVIDERS=mock npm start
   ```
   Check the result with `curl localhost:8080/api/v1/workflow` (recipe, temperatures, grinder setting) and `curl localhost:8080/api/v1/machine/shotSettings`.

Notes:
- Playwright with Chromium is required. If the environment already provides a Chromium build for Playwright, use it rather than installing another.
- Bare `?demo` on a wide desktop window opens the device frame. The scripts add `&full` to test the app itself.
- When stopping background servers, kill by PID. `pkill -f <pattern>` can kill your own shell.
