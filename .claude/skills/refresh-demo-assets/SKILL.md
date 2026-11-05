---
name: refresh-demo-assets
description: Regenerate Crema's demo assets after a UI or data change. Covers the sample coffees and AI recipes, skin/demo-data.js, the built single-file demo, README screenshots, the walkthrough's highlight boxes, the README animation and MP4, and the GitHub Pages site. Use when screenshots or the demo look out of date.
---

# Refresh demo assets

Steps 1–2 make real AI calls (cost and time); the rest are free and local. Run only what's stale, in this order.

1. **Sample coffees** (rarely needed): about 30–40 s per coffee through the owner's Claude subscription.
   ```bash
   LLM_PROVIDERS=claude-cli npx tsx scripts/seed-samples.ts
   ```
   Writes `samples/beans.json`. Edit the coffee list at the top of the script. Bag-only facts (roast date, bag size, used grams, packshot colours) live in `BAG` in `scripts/build-demo-data.ts`; add an entry for any new coffee or the build fails.

2. **Real AI recipes**: about 8–14 s per coffee and drink preference.
   ```bash
   LLM_PROVIDERS=claude-cli npx tsx scripts/seed-recipes.ts
   ```
   Writes `samples/recipes.json` (for "both" and "milk"; "straight" falls back to rules in the demo).

3. **Demo data and built demo**:
   ```bash
   npx tsx scripts/build-demo-data.ts && node scripts/build-demo.mjs
   ```
   Then run `node scripts/e2e-demo.cjs --built`. It must pass: the built file is what the Claude artifact shows.

4. **Screenshots**:
   ```bash
   node scripts/screenshots.cjs
   ```
   Writes `docs/screenshots/*.png`: the tablet at 1340×800, phones at 2×, themes at half size, plus `boxes.json`. If the layout moved, copy the numbers from `boxes.json` (rounded) into the `BOXES` constant in `demo/walkthrough.html`.

5. **Site and recording**:
   ```bash
   node scripts/build-site.mjs && node scripts/record-walkthrough.cjs
   ```
   Updates `docs/media/walkthrough.webp` (the README animation, about 5–6 MB) and `walkthrough.mp4`. Needs ffmpeg with `libwebp_anim` and `libx264`.

6. **Publish**: push to `main`. `.github/workflows/pages.yml` rebuilds `_site/` and deploys to https://gauravawadhwal.github.io/crema/. Check the run with:
   ```bash
   gh api "repos/gauravawadhwal/crema/actions/runs?per_page=1"
   ```
   If the owner keeps Claude artifact copies, republish `demo/crema-demo.html` and `demo/walkthrough.html` (the walkthrough needs its `shots/*.png` files passed alongside).

Keep the sample data public-safe: roasters' public product information only. No personal data, addresses or account details.
