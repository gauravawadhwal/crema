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
| Tablet landscape (`min-width 900`, `max-height 860`, landscape) | Fixed-height, no page scroll on Brew | Rail · next shot · shorter live chart · controls, with a favourites carousel across the bottom. After a shot, the rating strip replaces the readouts |
| Tighter tablet heights (`max-height 640`, `580`) | Progressive compaction | Hides the legend and after-shot metrics, shrinks steppers and carousel cards; controls keep their full height so Stop remains visible. The feedback panel scrolls inside its own bounds |
| Desktop / wide | `max-width 1180` breakpoint | Controls wrap under the chart |
| Phone (`max-width 760`) | Scrolling single column | Expandable status line and Demo chip; fixed Espresso/Stop above the bottom tabs, including while visiting another view; side-by-side time and weight, yield, current step and chart fit the pouring viewport |
| Shots (`min-width 761`) | Fixed-height workspace | Status and heading stay visible; the shot list and detail panel scroll independently. Selecting a shot preserves the list position and starts its detail at the top; phone keeps stacked page scrolling |
| Shelf | Cards of equal height | Each card has one primary action, "Brew this" (or "Brewing"), and a square More button that opens a sheet with Freeze or Thaw, Finished, Another bag, Set what's left and the roaster's page. Origin and recipe lines clamp to two lines and the tasting notes to one row. Chips above the grid filter by All, In its window, Resting and Running low (this device only) |
| Shots, list | Filter and compare | Chips above the list narrow the loaded shots to one coffee (they scroll sideways; "Show more" still pages the whole history). Each row has a labelled Compare control at full touch size |
| Settings (tablet and desktop) | Section index | A sticky strip of the card titles scrolls the chosen card into view; the phone keeps the single column without it |
| Desktop demo, top-level | `showDeviceFrame()` | The app in a 1340×800 (or 390×844) iframe inside a bezel, scaled to fit; `?full` opts out |

**Target device:** a 1340×800 landscape Android tablet, the size the community Lumen skin also targets (for example an 8.7-inch Samsung Galaxy Tab A-series). Android may scale web pages, so the tablet layout is tested at 1340×800, 1340×752 (nav bar), 1206×720, 1005×600 and 1005×552 by `scripts/check-tablet-fit.cjs`.

## Components

- **Favourites**: a bottom carousel of consistent-width recipe cards, with swipe/drag, snapping and previous/next arrows. No automatic advance or wraparound. Show a partial next card when more recipes are available. Cards show name, profile and dose/yield (plus temperature when space allows); the prepared recipe gets an accent border. Save current recipe is the last card. Edit switches the cards to management, separate from loading. There is no fixed slot count; older empty slots are retained in storage but omitted from the carousel. Keyboard arrows/Home/End navigate without loading; reduced-motion settings disable animated navigation. Swipe/drag must never become a recipe tap.
- **Status chips** (top bar): machine state with a dot (green ready, amber heating, pulsing accent when busy, red problem), group and steam temperatures, water tank gauge, scale (tap to tare), maintenance due.
- **Recipe values**: Dose, Yield and Temp are equal tiles opening a tabbed value sheet. The sheet keeps a draft across tabs, with a snapping draggable ruler, keyboard arrows/Home/End, recent values from shot history, and Set at the bottom right. Cancel, Escape, the scrim and a downward handle swipe discard the draft. Manual and bagless yield can be Off; the sheet retains the scale-stop caution. Set edits the next recipe only; Load or Espresso sends it to the machine. Long profile names are limited to two lines.
- **Steppers**: Grind stays inline and accepts text, with a configurable numeric start and step (10 and 0.25 by default). Grind, value-sheet and Settings buttons repeat after a 400 ms hold and accelerate. A tap steps once. Settings holds save the final value through the existing merge handlers after release.
- **Machine controls**: each operation gets a big button plus preset chips. Stop is always present and turns red while something runs.
- **Charts** (`drawChart`): pressure and flow share 0–12; weight on the right axis; temperature in a 70–100 °C band. Targets are dashed and the reference shot is faint. Before a shot, the dashed lines are the loaded profile's plan (`E.profileCurve`): timed from the last shot with that profile when there is one, otherwise each step at its time limit, which the hint says. The hint is a muted line in the chart panel's header, never drawn over the plot. Brew's legend leaves out Pressure, Flow, Weight and Temp (the readouts above name them) and keeps what dashed and faint lines mean. The reference shot is optional and removable from the legend. Recipe labels read "AI pick" or "Rules pick"; the provider id is shown only in Settings. Draw on canvas at device pixel ratio and read colours from tokens at draw time.
- **Feedback**: taste and body are five-option tap scales (sour → bitter, thin → heavy), not sliders, followed by a five-star rating in half steps that you tap or drag across (stored as Decaid's 0–10, one point per half star). Taste and body start unset; both must be selected to supply numeric taste feedback. Review shot uses recorded curves with optional taste and saves the result. The accent-ruled review box shows observations, their evidence and at most one next-shot change, or asks for more evidence.
- **Sleep screen**: black, with the clock, the date in words and the wake instruction. By default a tap wakes; the per-device "Hold to wake" setting needs a press held for about one second, with a ring that fills while held (a static brighter state under reduced motion), and releasing early sends nothing. Enter or Space on the focused screen always wakes. The optional per-device "Chime" is a quiet two-note Web Audio sound for a shot ending and the machine reaching temperature; it plays only for a change the open page watched happen, and fails silently when the browser blocks audio. Both are off by default and saved in `localStorage`, not in Decaid.
- **Pills**: rest status (resting / in its window / past its best), timing (in window / fast / slow), provenance tags.

## Copy

- Write from the user's side, plainly, in short sentences. Name actions by what happens ("Load onto machine", "Set as reference", "Mark finished").
- Errors say what went wrong and what to do ("Can't reach the machine. Check that Decaid is running…").
- Numbers carry units, and ratios are written `1:2.2`.
- Avoid jargon the user didn't choose. Profile names are shown exactly as on the machine.

### Brew at rest (WS 3)

Steam, Hot water and Flush use split buttons: the main area starts the selected
preset and the disclosure opens its selection sheet. Selecting a preset never
starts an operation; editing stays in Settings. The scale tile shows weight and
battery with a separate Tare button. Status and chart weight readings are passive.
Stop is pinned to the bottom of the tablet control column and stays in the same
rectangle before, during and after a shot. The machine-start-only setting labels
Espresso “Start at group head”.

At rest, a proportional step rail sits above the plan chart, and series labels are
drawn directly beside the dashed plan lines when they fit. The live readings and
clock stay hidden until an operation or recorded trace exists. The rail hides at
the two shortest tablet heights. Favourite cards retain their carousel and edit
behaviour, adding coffee artwork (a neutral initial tile when absent) and a small
pressure sparkline from the installed profile.

## Pour mode

A running shot takes over Brew with its captured profile and recipe, a step rail,
large time and weight readings, yield progress and a live chart with the remaining
plan. Unknown recipe values or step frames remain unknown. Next-shot edits never
supply the active shot's labels or targets. Skip appears only for a known non-final
step of a non-manual profile and is disabled without a link or while a request waits.

Tablet pour Stop is 300×96 and contains its entire resting hit area. All tablet
sizes use the compact layout's bottom-right anchor, with Favourites spanning the
two left columns while at rest. Socket loss keeps the pour layout and Stop visible.
Secondary readouts and explanatory copy drop at compact sizes so time, weight and
Stop remain visible without scrolling. The dedicated phone arrangement is WS 8.

## Action feedback

Toasts stack up to three messages, with independent timers (2.8 seconds normally,
six with Undo). They sit below the tablet status bar and above the phone action bar.
Finished, Freeze/Thaw, clearing a favourite and removing a reference offer Undo.
Async action buttons ignore repeated taps until the request settles and show a pending
state after 300 ms. Start and Stop retain their control handling. Link-loss banners
wait 1.5 seconds; controls and active-shot protection react immediately. Technical
error text is replaced with a plain sentence.
The live pour chart starts at 40 seconds and widens by 10 seconds when elapsed time
reaches one second before the edge, up to 120 seconds. It resets for each shot;
plan, reference and ETA never size it. Plan and reference lines clip at the plot edge.
Steps ahead use the captured profile's last-shot timing when available, otherwise
say “up to” their time limit. Unreached steps say “not reached”; pre-shot labels name
the peak pressure and flow. Resting control tiles share spare height without moving Stop.
### Phone actions (WS 8)

The phone summary shows state, group temperature and water. Tap it to reveal the
other status readings and Sleep/Wake. Espresso stays above the tabs at rest; Stop
occupies that bar during any operation, with the bottom safe-area inset respected.
Stop remains reachable after scrolling, changing views or losing the machine socket
during a shot. The pouring view uses matching 52 px time and weight readings, yield
progress, the current step and a compact chart in the first 390×844 viewport.
