# Settings values and controls review

Reviewed 9 November 2026. Local corrections described below are not deployed to
the tablet or NAS. No live settings were written during this review.

## Actual defaults versus recommendations

The version-matched [Decaid 0.9.1 workflow models](https://github.com/decentespresso/decaid/blob/v0.9.1/lib/src/models/data/workflow.dart)
define these initial values. They are not necessarily the settings of an existing
machine, and are not instructions to reset one:

| Operation | Initial temperature | Initial flow | Other initial targets |
|---|---|---|---|
| Steam | 150 °C | 0.8 ml/s | 50 seconds; milk temperature stop off |
| Hot water | 75 °C | 10 ml/s | 50 ml; 30 seconds |
| Flush | 90 °C | 6 ml/s | 10 seconds |

Decent's [DE1 app quickstart guide](https://decentespresso.hk/docs/de1_app_quickstart_guide)
recommends steam at 160–165 °C and 0.4–1.2 ml/s for the DE1 Pro/XL, specifically
0.8 ml/s as a middle ground between speed and dry steam. This is guidance for
steaming performance, distinct from Decaid's initialization defaults. The live
machine inspected already uses 160 °C / 0.8 ml/s, so no adjustment is recommended
from this review. Do not raise Crema's temperature edit limit merely to match the
guide: its installed API/version constraints remain the relevant write contract.

Decent also describes [dialling in steam flow](https://decentespresso.com/docs/whats_the_advantage_of_changing_the_steam_flow_rate):
for a fixed milk quantity and temperature endpoint, reduce flow incrementally
until heating starts to take longer; excessive flow without faster heating adds
dilution. This is an optional performance experiment, not a prerequisite or a
reason to change the current working setup.

For the fan, the [Decaid 0.9.1 REST specification](https://github.com/decentespresso/decaid/blob/v0.9.1/assets/api/rest_v1.yml)
states that its initial threshold is 55 °C, which the DE1 clamps to 50 °C.
Installed Streamline 0.2.23's `src/settings/settings.js` likewise limits fan edits
to 0–50 °C, citing the DE1 MMR limits. The live machine reads 50 °C. Keep that
value. It controls when cooling starts, not fan speed. The older de1app quickstart
mentions 60 °C; do not transplant that into this version of Decaid. Lower
thresholds start cooling sooner, as the guide explains.

## Crema findings and local corrections

- Live fan, steam/hot-water temperature and flow, and flush controls read Decaid's
  current machine/workflow values. Opening Settings does not write defaults.
  Missing numeric values stay unavailable rather than becoming zero or a guessed
  fallback. Existing settings may have been changed by a user or another skin;
  a GET cannot establish their original provenance.
- Crema's named steam-duration, water-volume and flush-time presets are custom
  convenience recipes. They are not Decaid defaults. Selecting a preset or
  starting its operation from Crema applies that duration/volume. Temperature and
  flow remain in the Decaid workflow. The manual steam preset is capped at 255 s.
- The group-head toggle is a local UI preference only: it disables Crema's four
  start buttons and leaves Stop available. It does not enable/disable the physical
  controller. Relabelled to **Use only the machine's start buttons**, with explicit
  device-local help. No sharing redesign: the user subsequently confirmed that
  the settings they expected were visible through the NAS.
- Sleep numeric input previously had no bounds, so it could display/send negative
  values even though Decaid normalizes them. Local edits now follow Decaid's
  integer 0–240 range and read the accepted value back. Zero disables the idle
  timer; it is not a negative/infinite duration.
- Fan edits now follow the 0–50 °C DE1 range and read back the machine value.
  Blank or nonnumeric input is rejected without a write; no default is applied
  while opening the page.
- The refill-warning control previously displayed an invented 20% and sent an
  unsupported `warningThresholdPercentage` field. Decaid uses `refillLevel` in
  millimetres. The corrected control reads the water-level stream, writes that
  field, and uses 0–30 mm, matching [Decaid 0.9.1's water-level form](https://github.com/decentespresso/decaid/blob/v0.9.1/lib/src/home_feature/forms/water_levels_form.dart).
  The installed 0.9.1 specification confirms the field and units. The water status
  warns at the reported refill threshold rather than an invented percentage.
- Existing workflow edit bounds in `WF_LIMITS` are input guards, not defaults;
  its comments distinguish Decaid/Streamline constraints from Crema's own guards.
  This change does not replace those guards or introduce factory-reset actions.

Follow-up UI request: enlarge the favourites edit “⋯” target. Tracked separately
in [the implementation plan](implementation-plan.md); not part of these settings
corrections. Bagless/manual brewing remains planned separately.

## Local verification

Typecheck and all 167 tests pass. Source and built demo browser checks pass on
tablet and phone; tablet fit passes at every supported size; source and built
Stop/start race checks pass; skin packaging and ZIP validation pass. Settings
screenshots were visually checked at tablet and phone sizes. The live-path
simulator checks pass, including new regressions for no writes on settings entry,
actual Decaid values, sleep bounds, fan bounds and readback, rejection of a blank
fan field, refill writes in mm, a UI-only group-head preference and unavailable
machine values. Browser tests initially required correcting the test's synthetic
change/blur sequence; the final run uses normal typing/tabbing and passes.

Only GET requests were made to the live installation. Deployment and a tablet
check of the corrected settings screen are still pending.
