# Streamline and Crema: settings, features and ownership

Source audit: **10 November 2026**. This records what each interface exposes and
who should own it. A feature missing from Crema is not automatically work to build.
Crema owns the daily coffee → recipe → shot → feedback loop; specialist functions
should use maintained upstream screens where they actually work.

## Evidence and limits

| Component | Baseline inspected | Evidence |
|---|---|---|
| Crema | Local `codex/favourites-carousel`, `5d07139` | `skin/app.js`, `server/control/start.ts`, `server/shared/defaults.ts`; includes the unreleased carousel, not just installed v0.4.1 |
| Streamline skin | Latest published release `v0.2.24` | [Manual][manual], [settings navigation][settings-tree], [settings implementation][settings-code], [controls][controls], [app][streamline-app], [history][history], [profile library][profiles] |
| Standalone Streamline Settings | Latest published release `v0.1.4` | [Integration contract][plugin-readme], [navigation][plugin-tree], [implementation][plugin-code], [vendored-source record][plugin-version] |
| Plugin development branch | `08cf8cf5c66ba1d42efe6bef40f7bc52ff5735e4` | [Source record][plugin-main-version] says Streamline `v0.2.12`; different from the published plugin and current skin |
| Decaid contract | `v0.9.1`, the project's desktop baseline | [REST specification][rest]; an endpoint does not prove access from Crema |

The released plugin's source record says **Streamline v0.2.9**, not v0.2.24.
Its tag's committed generated manifest also says `0.1.3`; release automation may
stamp the downloadable artifact differently. These are source baselines, not
byte-for-byte validation of an installed/downloaded plugin. Read its reported
version and exercise its routes before selecting an integration dependency.

No browser session, desktop app, tablet, operation, plugin installation or settings
write was used for this audit. Existing simulator/hardware evidence is in
[implementation-plan.md](implementation-plan.md); no application checks were rerun here.
All proposed plugin/switch-and-return routes below remain **runtime-unverified**,
including phone layout, Android WebView navigation, accounts and save/cancel.
Baselines are not minimum-version guarantees. Classic `de1app`, Lumen and their
plugins were not re-audited; this is not a complete stock-app parity claim.

**Table status:** **Local** = exposed in Crema; **Partial** = only part exposed;
**Missing** = no equivalent Crema control/route; **Conditional** = hardware/plugin
needed. Proposed handoffs are not implemented links. The current tablet route is
Settings → Decaid → Open Decaid when the native host supplies it. Normal phone
browsers have no native dashboard exit; use Decaid's available web/plugin UI.

## Settings: all 11 Streamline sections

These **42 rows** cover every static sub-page in v0.2.24's `SETTINGS_TREE`.
Dynamic plugin cards depend on what Decaid reports. The released plugin has 41
sub-pages: no Grinder or Enable sounds, and an extra legacy Visualizer page.
Matching names do not guarantee matching behavior across these versions.

### Quick adjustments

| Streamline page | Crema exposure | Proposed owner and route |
|---|---|---|
| Flow calibration | Missing weight/volume stop lookahead multipliers | Decaid settings through specialist Settings; distinct from sensor calibration |
| Steam | Partial: temperature, flow, duration presets; no heater-off, stop-mode or milk-probe UI | Keep ordinary presets; specialist Settings for advanced fields, subject to runtime limits below |
| Hot Water | Partial: temperature, flow, volume presets; no duration editor or weight-stop/lookahead policy | Keep ordinary controls; delegate advanced Decaid policy |
| Water Tank | Partial: level and refill warning in mm; no tank-temperature/unit editor | Keep gauge/warning; delegate machine fields. Units need Crema support |
| Flush | Local temperature, flow, time presets | Keep; read/write current Decaid workflow |
| Machine Advanced Settings | Missing advanced heater/warmup fields | Specialist Settings; verify capability/read-only behavior against Decaid/firmware |

### Connections

| Streamline page | Crema exposure | Proposed owner and route |
|---|---|---|
| Machine | Partial: status/retry and Decaid address; no device discovery/preference/forget UI | Decaid/device screens or specialist Settings |
| Scale | Partial: weight, battery, tare; no pairing/reconnect, Wi-Fi entry, power-mode or Scale Required editor | Decaid owns devices/policy; specialist Settings route. Crema's setup scale switch affects recommendations, not pairing or `blockOnNoScale` |
| Grinder | Missing device/plugin discovery, Follow Grinder and Send Grind | Decaid + grinder plugin / Streamline. Released Settings plugin lacks this page; defer native integration |

### Calibration

| Streamline page | Crema exposure | Proposed owner and route |
|---|---|---|
| Default load settings | Missing reset action | Specialist Settings; do not reset values merely to validate access |
| Refill Kit | Missing | Specialist Settings / Decaid; capability-specific |
| Voltage | Missing | Specialist Settings / Decaid; no inferred setup changes |
| Fan | Local threshold, 0–50 °C with readback | Keep initially; resolve plugin restore conflict before adding a second editor |
| Steam | Partial: temperature/flow; no dedicated heater-enable/calibration screen | Specialist Settings; preserve Crema bounds pending installed-contract evidence |
| Sensor Calibration | Missing temperature/pressure/flow procedure | Specialist Settings / Decaid; separate from stop lookahead |
| Load Cells | Conditional: absent | Bengle-only specialist workflow; no DE1 Pro parity work |

### Machine

| Streamline page | Crema exposure | Proposed owner and route |
|---|---|---|
| Smart Charging | Partial: USB on/off only | Decaid charging policy through specialist Settings; targets/night schedule differ from USB |
| Cup Warmer | Conditional: absent | Bengle-only; no DE1 Pro work |
| Lighting | Conditional: absent | Bengle-only; no DE1 Pro work |
| Machine Information | Partial: capability reads, no information page | Specialist Settings / Decaid |

### Maintenance

| Streamline page | Crema exposure | Proposed owner and route |
|---|---|---|
| Clean | Missing cycle; local backflush reminder/Done today only | Specialist Settings / Decaid procedure; reminders do not clean |
| Machine Descaling | Missing cycle; local reminder/Done today only | Specialist Settings / Decaid procedure |
| Transport Mode | Missing air purge procedure | Specialist Settings / Decaid procedure |

### Skin, language and extensions

| Streamline page | Crema exposure | Proposed owner and route |
|---|---|---|
| Theme | Local six themes; Crema theme has auto/light/dark | Keep Crema's device-local appearance; plugin theme does not restyle it |
| Active Skin | Partial: dashboard exit, no installer/switcher | Decaid; candidate profile-editing handoff, return must be verified |
| Select Language | Missing translations/selector | Skin-owned; plugin language cannot translate Crema. Defer unless requested |
| Shot Uploader | Missing Decent-account upload UI | Decaid shot-upload plugin; distinct from Visualizer |
| Plugins | Partial: selected plugin status and dashboard exit; no generic cards/settings/surfaces | Specialist Settings / Decaid for configuration and plugin pages; Brew surfaces are separate work |

### Miscellaneous

| Streamline page | Crema exposure | Proposed owner and route |
|---|---|---|
| Decaid Settings | Partial: dashboard exit; no build/update/gateway/log controls | Decaid / specialist Settings; platform limits app updates |
| Brightness | Local slider when Decaid reports support | Keep platform-gated Decaid brightness; verify target tablet versus remote browser |
| Wake Lock | Missing explicit keep-screen-awake control | Assess host/browser support; plugin setting does not prove Crema holds a wake lock |
| Presence Detection | Partial: idle sleep and add/day/enable/remove wake schedules | Keep daily controls; no keep-awake override or wake-profile runtime in Crema |
| Display Size | Missing zoom/stretch settings | Crema has its own responsive layout; do not import Streamline scaling |
| Temperature | Missing °F preference; Crema uses °C | Skin-owned conversion if requested; API temperatures stay °C |
| Screen Saver | Partial: device-local asleep clock/tap to wake | Keep simple clock; no custom images/cycle/clock-format/position options. Plugin preferences do not implement them |
| Keyboard Shortcuts | Missing machine shortcuts/editor | Skin-owned, optional; carousel navigation keys are different |
| Home Assistant | Missing integration | Streamline-owned runtime; its configuration does not integrate Crema. Deferred |
| Enable sounds | Missing tap-sound preference | Skin-owned, optional; released plugin lacks this page |

### Updates and user manual

| Streamline page | Crema exposure | Proposed owner and route |
|---|---|---|
| Firmware Update | Missing machine firmware UI | Specialist Settings / Decaid; distinct from Decaid app update |
| Quick Start Guide | Partial: repo install guide; no in-app guide/help overlay | Keep docs; optional small Crema help entry |
| Talk to Decent | Missing support conversations | Streamline / specialist Settings, subject to account/platform support |
| Send Feedback | Missing account-linked reporting UI | Streamline / specialist Settings or project issue route; no automatic messages |

## Features outside Settings

Sources: [manual][manual], [controls][controls], [app][streamline-app],
[history][history], [profile library][profiles] and Crema `skin/app.js`.
Standalone Settings is not Streamline's main screen or profile editor.

| Feature | Crema exposure | Ownership / difference |
|---|---|---|
| Tablet home without page scrolling | Local | Existing fit checks: 1340×800 down to 1005×552; not rerun here |
| Espresso / steam / hot water / flush / Stop | Local | Crema guards starts/loads; Decaid executes |
| Physical-start-only preference | Local | Disables Crema starts per device, preserves Stop. Streamline instead hides its action column on GHC machines |
| Sleep/wake | Local | Crema buttons, Decaid state |
| Pressure/flow/temperature/weight and timer | Local | Live readings/chart/targets; not identical sensors/metrics |
| Phase/step display and skip-step | Partial | Crema shows phase; no skip action. Streamline indicator sends `skipStep` |
| Profile plan before brewing | Local | Last matching shot timing when available, otherwise step limits |
| Reference shot and compare | Local | Optional per-coffee reference and two-shot history overlay |
| Chart expansion/fullscreen | Missing dedicated expansion | Streamline offers chart expansion/browser fullscreen; optional |
| Running steam/water/flush screen | Local | Progress/timer and Stop; estimate is not a sensor measurement |
| Water warning and Time To Ready | Local / Conditional | Gauge/refill threshold; ETA needs Time To Ready plugin |
| Favourite profiles/recipes | Local | Unreleased Crema carousel: recipe snapshots, no five-entry cap. Streamline: five profile slots, optional DYE2 strips |
| Dose / yield / ratio / brew temperature | Local | Next-shot edits; temperature shifts every profile step |
| Grind note / numeric stepper | Local | Shared start/step; recorded with shot, no grinder command |
| Stop at weight | Local via Decaid | Yield target, functioning scale needed. Scale-required policy needs separate integration coverage |
| Stop at volume | Partial | Loads inherit installed profile target; no separate next-shot water-volume editor |
| Load edits before screen start | Local | Espresso loads first; physical starts need prior Load |
| Steam time presets | Local, different semantics | Manual/∞ maps to a **255-second cap**, not unlimited steam |
| Steam flow/temperature editing | Local | Settings rather than Streamline's home tile modes |
| Auto-steam pitcher/calibration mode | Conditional: missing | Streamline + Auto Steam Calculator; no Crema arming/calibration lifecycle |
| Milk-temperature steam stop | Conditional: missing UI | Supported probe/Bengle in Streamline; no DE1 Pro parity work |
| Eco steam | Missing runtime | Streamline activity timer/transient boiler writes; not an inherited Decaid setting ([source][eco]) |
| Hot-water/flush presets | Local | Volume/time, temperature and flow; advanced duration/weight-stop policy not exposed |
| Scale weight/battery/tare | Local | Device/power/required policy covered above |
| Beans / multiple bags / freeze / finish | Local | Decaid records; shelf/bag switching and per-bag remaining |
| Days off roast / rest / remaining / reorder | Local | Crema daily coffee UI/rules |
| Identify via photo/description/link | Local with optional server | Manual entry with AI off. Speak hidden in Decaid WebView; keyboard dictation remains |
| Coffee-fact provenance / roaster photo | Local | Crema's identification/source tags and optional product image; not supplied by Streamline Settings |
| Grinder entities / numeric grind advisor | Missing entities; partial advice | Setup burr preference and grind note/stepper are not Decaid grinder records. Taste-based advice exists; no calibrated “finer by N” advisor |
| No bag brewing | Local | Installed-profile choice, no coffee association/inventory deduction |
| Manual flow/pressure | Conditional: local choices | Installed GHC profiles, physical controller; hardware behavior/scale stop unverified |
| Installed-profile browse/notes/search/graph | Local | Decaid library plus Crema guide/ranking; not every profile is in the guide |
| Profile recommendations | Local | Rules and optional AI among installed candidates, with reasons |
| Create/edit steps (including D-Flow/A-Flow) | Missing editor | Streamline editor; no independent maintained entry established here |
| Profile rename/duplicate/delete/hide/restore | Missing management UI | Streamline selector/editor; built-ins hidden rather than deleted |
| Local JSON / Visualizer-code import | Missing | Streamline editor; share-code import has account requirements. Not in Settings plugin |
| Decent Profile Generator | Conditional: no Crema launch UI | Separate Decaid plugin; screen route needs validation |
| Shot history/paging/curves/metrics | Local | Crema UI, Decaid shot records |
| Rating/notes/taste/next adjustment | Local | Decaid 0–10 annotations and Crema feedback; AI/rules advice |
| Shot review | Local | Curve checks and optional saved AI review; calibration still open |
| Copy/share shot summary | Missing dedicated action | Streamline history copies Markdown; optional |
| Delete shot | Missing | No delete action found in inspected Streamline history menu either; Decaid API is not an exposed UI |
| Visualizer upload | Partial: status/guidance | Crema checks ID only, not loaded/enabled/account/success. Streamline has account-gated per-shot upload |
| Derek conversation | Missing chat | Streamline uses Decaid Derek; Crema review/advice is different. No chat work by inference |
| DYE2 / assisted dial-in / bean-scale capture | Conditional: no direct integration | Streamline plugin surfaces; Crema overlaps purpose, not integration/storage contract |
| Generic plugin header/tile/history surfaces | Missing | Hand off plugin pages; Brew surfaces are separate product work |
| Help overlay / machine shortcuts | Missing | Optional Crema work; not inherited from Settings |
| Maintenance reminders | Local | Crema KV shot/day reminders, not actual procedures |
| Phone companion / themes / no-server rules | Local | Keep responsive UI/optional-server contract; plugin pages need separate phone checks |

## Integration findings

1. **Settings entry is access work, not full parity.** The published plugin is
   older than the skin, lacks Grinder/sounds pages and supplies no profile editor.
   Its development `profiles-lite.js` only populates the wake-profile selector.
   Verify the chosen release instead of promising “all Streamline settings.”
2. **Delegated Settings can conflict with later Crema edits.** Released
   [settings code][plugin-code] calls `checkMachineSettingsDrift` after loading its
   legacy UI. It reads `userMachineSettings` from IndexedDB and posts differing
   tracked DE1/advanced values back silently. `syncMachineSettingsRecord` tracks
   values previously saved there. A later fan/USB edit in Crema can therefore be
   treated as drift. This is a source-confirmed path, not a reproduced runtime
   failure. Quick Adjustments initially uses a separate lightweight loader: test
   a legacy category with a nonempty saved record, not just the landing page.
3. **Cancel is not a universal rollback.** Preferences, connection actions and
   procedures have immediate paths. Cancel clears staged changes, but cannot be
   assumed to undo everything. Re-read effective values after either exit.
4. **Skin preferences need their skin's runtime.** Plugin `streamlineSettings`
   does not implement Crema language, °F, shortcuts, zoom, theme, screensaver,
   wake-profile loading, Home Assistant or eco steam. [Streamline's app][streamline-app]
   starts its eco timer and loads wake profiles; Crema does neither.
5. **Name the actual control.** Crema's setup scale switch is not Scale Required;
   USB is not Smart Charging; reminders are not procedures; Visualizer
   “Available” means ID found. Manual steam is capped at 255 seconds.
6. **Crema reapplies selected presets on start.** A steam duration, water volume
   or flush duration saved elsewhere need not be the next Crema target. Keep
   preset ownership explicit, preserve other workflow fields and retain current
   bounds until the installed API justifies a change.

## Recommended disposition

The [phase 3 plan](implementation-plan.md#phase-3--reuse-settings-and-preserve-feature-access-r12)
records proposed priorities and acceptance. Resolve the delegated settings contract
and restore conflict first, then make settings/profile management reachable.
Keep working daily controls during that work. Discuss skip-step and a small
plugin/help entry separately. Shortcuts, °F, auto/eco-steam, richer screensavers,
grinder control and chat remain choices, not approved implementations.
No tablet session is requested by this source audit.

[manual]: https://github.com/decentespresso/streamline-js/blob/v0.2.24/README.md
[settings-tree]: https://github.com/decentespresso/streamline-js/blob/v0.2.24/src/settings/settings-tree.js
[settings-code]: https://github.com/decentespresso/streamline-js/blob/v0.2.24/src/settings/settings.js
[controls]: https://github.com/decentespresso/streamline-js/blob/v0.2.24/src/modules/ui.js
[streamline-app]: https://github.com/decentespresso/streamline-js/blob/v0.2.24/src/modules/app.js
[history]: https://github.com/decentespresso/streamline-js/blob/v0.2.24/src/modules/history.js
[profiles]: https://github.com/decentespresso/streamline-js/blob/v0.2.24/src/modules/profileManager.js
[eco]: https://github.com/decentespresso/streamline-js/blob/v0.2.24/src/modules/eco-steam.js
[plugin-readme]: https://github.com/decentespresso/streamline-setting/blob/v0.1.4/README.md
[plugin-tree]: https://github.com/decentespresso/streamline-setting/blob/v0.1.4/settings-plugin/src/app/settings-tree.js
[plugin-code]: https://github.com/decentespresso/streamline-setting/blob/v0.1.4/settings-plugin/src/app/settings.js
[plugin-version]: https://github.com/decentespresso/streamline-setting/blob/v0.1.4/settings-plugin/upstream.json
[plugin-main-version]: https://github.com/decentespresso/streamline-setting/blob/08cf8cf5c66ba1d42efe6bef40f7bc52ff5735e4/settings-plugin/upstream.json
[rest]: https://github.com/decentespresso/decaid/blob/v0.9.1/assets/api/rest_v1.yml
