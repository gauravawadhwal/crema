# Design

## Principles

- **An instrument panel, not a website.** Flat surfaces, thin lines, monospace numerals for every reading, and no decoration that doesn't carry information.
- **It lives next to a machine.** It's dark-first, has big touch targets (at least 44 px, 34 px only in the tightest tablet layout), and the important controls never move.
- **Tell people where facts come from.** Coffee facts are tagged `bag`, `web` or `inferred`; recommendations show their reasons and cautions; the demo is labelled as simulated.
- **One screen on the machine.** The tablet home screen never scrolls.

## Tokens

All colour comes from CSS custom properties defined on `:root` in `skin/index.html`. Components never use literal colours (the only exceptions are the device-frame bezel and the screen saver, which are always black).

| Token | Role |
|---|---|
| `--bg`, `--surface`, `--surface-2`, `--line` | Page, panels, inset controls, borders |
| `--fg`, `--muted` | Text |
| `--accent`, `--accent-ink` | Primary actions, selection, brand mark; text on the accent |
| `--pressure`, `--flow`, `--weight`, `--temp` | Telemetry: pressure green, flow blue, weight brown, temperature red/orange (the Decent convention, kept in every theme) |
| `--good`, `--warn`, `--bad`, `--stop` | State: in window / attention / problem; the Stop button |
| `--shadow`, `--r` | Panel shadow and corner radius (per theme) |
| `--font-display`, `--font-body`, `--font-mono` | Familjen Grotesk (headings), IBM Plex Sans (text), IBM Plex Mono (numbers) |

## Themes

| Id | Name | Idea | Mode | Radius |
|---|---|---|---|---|
| `verde` | Verde (default) | Vintage Italian café: bottle green and brass | dark | 12 |
| `crema` | Crema | Roasted brown and crema gold | follows light/dark | 14 |
| `rosso` | Rosso | Italian bar machine: red lacquer on polished steel | light | 8 |
| `acciaio` | Acciaio | Industrial black and steel, like the DE1 | dark | 6 |
| `nordic` | Nordic | Light-roast café: birch, ink, fjord blue | light | 18 |
| `notte` | Notte | True black, dim amber, low glare | dark | 14 |

**How it works:**
- `html[data-skin=…]` selects a theme; Crema has no attribute. `index.html` ships with `data-skin="verde"` so the first paint is already the default.
- The default is `DEFAULT_SKIN` in `app.js` (Verde). Crema's tokens sit on plain `:root`, so they are also the fallback if no theme block matches.
- `html[data-theme=light|dark]` is the light/dark setting, used only by Crema. An embedding host can also set it.
- Theme blocks use `html:root[data-skin="…"]` so they outrank the light/dark blocks.
- The choice is stored per device in `localStorage` (`crema:look`, `crema:theme`), and only when someone picks a theme, so a device that never chose follows the default if it changes.

**Adding a theme:**
1. Add a `html:root[data-skin="id"]` block in `index.html` defining every token above, plus `color-scheme`.
2. Add an entry to `SKINS` in `app.js` (name, one-line note, preview colours).
3. Add the id to the theme loop in `scripts/screenshots.cjs` and the themes slide in `demo/walkthrough.html`.
4. Keep the telemetry hues recognisable, and check contrast on both the chart and the primary button.

Theme names are Italian or coffee-world words. Don't use a real company's name, logo or exact trade dress; Rosso is a nod to Italian bar machines, not a copy of any brand.

## Layouts

| Context | Rule | Layout |
|---|---|---|
| Tablet landscape (`min-width 900`, `max-height 860`, landscape) | Fixed-height, no page scroll on Brew | Rail · next shot · live chart (flexes) · controls. After a shot, the rating strip replaces the readouts |
| Tighter tablet heights (`max-height 640`, `580`) | Progressive compaction | Hides the legend, after-shot metrics and favourites hint, and shrinks steppers |
| Desktop / wide | `max-width 1180` breakpoint | Controls wrap under the chart |
| Phone (`max-width 760`) | Scrolling single column | Bottom tab bar; controls first, then the live chart, then the next shot |
| Desktop demo, top-level | `showDeviceFrame()` | The app in a 1340×800 (or 390×844) iframe inside a bezel, scaled to fit; `?full` opts out |

**Target device:** a 1340×800 landscape Android tablet, the size the community Lumen skin also targets (for example an 8.7-inch Samsung Galaxy Tab A-series). Android may scale web pages, so the tablet layout is tested at 1340×800, 1340×752 (nav bar), 1206×720, 1005×600 and 1005×552 by `scripts/check-tablet-fit.cjs`.

## Components

- **Status chips** (top bar): machine state with a dot (green ready, amber heating, pulsing accent when busy, red problem), group and steam temperatures, water tank gauge, scale (tap to tare), maintenance due.
- **Steppers**: − value + with a sub-label (ratio, units). Grind is a free-text field with ± 0.5.
- **Machine controls**: each operation gets a big button plus preset chips. Stop is always present and turns red while something runs.
- **Charts** (`drawChart`): pressure and flow share 0–12; weight on the right axis; temperature in a 70–100 °C band. Targets are dashed and the reference shot is faint. Draw on canvas at device pixel ratio and read colours from tokens at draw time.
- **Feedback**: taste and body are five-option tap scales (sour → bitter, thin → heavy), not sliders, followed by stars. Advice is one change, shown in an accent-ruled box.
- **Pills**: rest status (resting / in its window / past its best), timing (in window / fast / slow), provenance tags.

## Copy

- Write from the user's side, plainly, in short sentences. Name actions by what happens ("Load onto machine", "Set as reference", "Mark finished").
- Errors say what went wrong and what to do ("Can't reach the machine. Check that Decaid is running…").
- Numbers carry units, and ratios are written `1:2.2`.
- Avoid jargon the user didn't choose. Profile names are shown exactly as on the machine.
