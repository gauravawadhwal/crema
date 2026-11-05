# Day-to-day parity with the Decent app

The goal: Crema can replace the stock DE1 interface for daily use. This list
compares it with the stock de1app, Decent's Streamline skin (the Decaid
reference skin), the Lumen skin, and popular plugins (Describe Your Espresso,
Visualizer upload, Grind Advisor, Maintenance Tracker).

Sources: the Streamline.js manual, the Lumen skin README, Decaid's API docs and
bundled plugins, and Decent's published guidance. Stock-app details still need
confirming against a real machine.

✅ done · 🟡 partial · ⬜ not yet

## Home screen and machine controls

| Feature | Where it comes from | Crema |
|---|---|---|
| Home screen fits the tablet with no scrolling | Stock | ✅ tested at 1340×800 and scaled sizes down to 1005×552, before and after a shot (`scripts/check-tablet-fit.cjs`) |
| Espresso, Steam, Hot water, Flush, Stop buttons | Stock, Streamline | ✅ right-hand column (phone: top) |
| Hide start buttons on group-head-controller machines | Streamline | ✅ "Start from the group head" setting; Stop and presets still work |
| Sleep / wake button | Stock, Streamline, Lumen | ✅ rail (tablet), top bar (phone) |
| Live pressure, flow, weight, temperature | Stock, all skins | ✅ readouts + chart, targets dashed |
| Shot timer and phase (preinfusion / pouring) | Stock, Lumen | ✅ |
| Live chart with profile targets | Streamline | ✅ dashed target pressure and flow |
| Reference ("god") shot overlay | DSx, community favourite | ✅ pin per coffee; faint curves on the live chart |
| Steam / water / flush running screen with big timer and stop | Lumen | ✅ overlay with progress and remaining time |
| Water tank level and low-water warning | Stock, Lumen | ✅ top-bar gauge; red under the threshold; refill banner when empty |
| "Ready in N min" while heating | Decaid Time To Ready plugin | ✅ shown in the status chip |
| Five favourite slots (tap to load, long-press to reassign) | Streamline | ✅ five slots; tap empty to save, ⋯ to rename, replace or clear |
| Keyboard shortcuts (E/S/W/F/Space) | Streamline | ⬜ |
| Help overlay | Streamline | ⬜ |
| Cup warmer toggle | Streamline (Bengle only) | ⬜ |

## Next-shot settings

| Feature | Where | Crema |
|---|---|---|
| Profile, dose, yield (with ratio), temperature | All | ✅ steppers; ratio and auto-stop shown |
| Grind setting recorded with the shot | Streamline, Lumen | ✅ per coffee; saved in the shot's workflow context |
| Temperature change shifts every profile step | Stock | ✅ keeps declining-temperature profiles' curves |
| Stop at weight (scale) | Stock, Streamline | ✅ via Decaid; yield is the target weight |
| Bag cycler ◀ ▶ | Lumen | ✅ |
| Load before start | — | ✅ Espresso loads unsaved changes first |

## Steam, hot water, flush

| Feature | Where | Crema |
|---|---|---|
| Steam by time, with presets (jugs) | Streamline, Lumen | ✅ editable presets; 0 = run until stopped |
| Steam temperature and flow | Stock | ✅ Settings |
| Hot water by volume, presets, temperature, flow | Streamline, Lumen | ✅ |
| Flush time presets, flow, temperature | Streamline, Lumen | ✅ |
| Steam by flow mode / auto-steam pitcher calculator | Streamline plugin | ⬜ |
| Eco steam | Stock calibration | ⬜ (Decaid API doesn't expose it yet) |

## Scale

| Feature | Where | Crema |
|---|---|---|
| Live weight and battery | All | ✅ top bar and readouts |
| Tare | All | ✅ tap the weight |
| Reconnect / scale required / power mode | Streamline settings | ⬜ (handled in Decaid's own settings) |

## Coffee (beans, bags, grinder)

| Feature | Where | Crema |
|---|---|---|
| Bean and bag records (DYE, Beanie) | Plugins / skins | ✅ stored in Decaid's Beans API |
| Identify from a bag photo, search or link | — | ✅ Crema's AI pipeline |
| Roaster product photo | — | ✅ |
| Days off roast and rest window | Lumen (bag counts) | ✅ |
| Grams left and reorder nudge | Community request | ✅ from shot doses |
| Freeze / thaw a bag, mark finished | Decaid batches | ✅ |
| Grinder entities (burrs, step sizes) | Decaid Grinders API | ⬜ (grind is a free-text setting for now) |
| Grind advisor ("finer by 0.5", confidence) | Lumen Grind Advisor | 🟡 taste-based next adjustment; no numeric advisor yet |

## Profiles

| Feature | Where | Crema |
|---|---|---|
| Browse profiles with notes | Stock, Streamline | ✅ 31-profile community catalog with filters |
| Recommendations for the coffee | — | ✅ rules ranking + AI choice, with reasons |
| Hide / restore built-ins | Streamline | ⬜ |
| Profile editor (steps, D-Flow, A-Flow) | Stock, Streamline, plugins | ⬜ use Decaid's editor; Crema shows and loads profiles |
| Import from Visualizer share code | Streamline | ⬜ |
| Decent Profile Generator | Decaid plugin | ⬜ available in Decaid; not surfaced yet |

## Shots

| Feature | Where | Crema |
|---|---|---|
| History with curves | All | ✅ list with sparklines |
| Shot metrics | Streamline | ✅ time, first drops, yield, ratio, peak, average flow |
| Compare two shots | Community favourite | ✅ tick a second shot to overlay it |
| Rating and notes | DYE | ✅ saved as Decaid annotations |
| Taste feedback → next adjustment | — | ✅ |
| Upload to Visualizer | Plugin | 🟡 via Decaid's Visualizer plugin (status shown in Settings) |
| Delete shot | Decaid | ⬜ |

## Machine, sleep and display

| Feature | Where | Crema |
|---|---|---|
| Auto-sleep after inactivity | Decaid presence | ✅ |
| Wake schedules (time + days) | Decaid | ✅ add, toggle, choose days, remove |
| Screen saver (clock while asleep; tap wakes) | Streamline | ✅ |
| Brightness | Streamline | ✅ |
| Themes | Lumen (dark/light/custom) | ✅ six themes (Crema with auto/light/dark, Rosso, Acciaio, Nordic, Verde, Notte) |
| USB charging, fan threshold, water warning | Stock / Decaid | ✅ |
| Descale / backflush reminders | Maintenance Tracker plugin | ✅ counts shots and days; "done today" resets |
| Descale and cleaning workflows | Stock | ⬜ (run from Decaid) |
| Firmware updates, calibration, language, units | Stock / Decaid | ⬜ (Decaid's own settings) |

## Beyond the stock app

- AI identification of coffees, with per-fact provenance.
- Profile choice explained in terms of what the roaster says about the coffee.
- The same app on your phone: add bags, watch shots, start steam, and check the tank from the couch.
