# Matched pair design

Claude Opus authored the physical models and label definitions independently of Crema's gym kernel. The authoring review corrected three issues before acceptance. It removed timing allowances already applied by the grader, required an active flow cap for the adaptive handoff, and replaced a latent tare-offset figure with an observable discontinuity. A Gemini cross-check independently recomputed the decisive serialized readings for pairs B, C and D.

| Pair | One changed fact | Evidence from serialized samples | What the review must leave open |
| --- | --- | --- | --- |
| `a1/a2` · Allongé-style | Effective hydraulic resistance, 0.8 vs 2.6 bar per mL/s | Same 4.5 mL/s flow command and 8.6 bar cap. Over 10–30 s, low resistance gives 4.500 mL/s at 3.600 bar. The capped arm gives 3.308 mL/s at 8.600 bar, a 1.192 mL/s deficit. | The pressure ceiling is not a pressure setpoint. The trace cannot assign grind, prep, channeling or taste. |
| `b1/b2` · pressure decline | Pressure command follows a 9 → 6 bar ramp vs stays at 9 bar. Both arms use the same hidden pressure-authority envelope. | Measurements match sample for sample aside from the command channel. The measured 9 → 6 bar fall starts after the 16 s boundary. Maximum absolute command error from 16 s is 0.038 vs 3.000 bar. The terminal signed shortfall is 0 vs 3 bar. | The cause of tracking shortfall requires independent controller or hydraulic evidence. A falling measured curve alone cannot identify whether the decline was commanded. |
| `c1/c2` · limiter handoff | External interruption absent vs at 15 s | Both show 2.172 mL/s near the 2.2 mL/s limiter with pressure short of the 8 bar command. The 9.50 s pressure-mode sample is 6.301 bar, and the 9.75 s first flow-mode sample is 6.666 bar. They bracket the configured 6.4 bar threshold. The full run ends at 27.75 s in zero-based frame 2. The interrupted run ends in frame 1. | The crossing time inside the bracket, the firmware's exact exit attribution and the motive for the API stop require other evidence. Without the live commands and frames, the control transition is uncertain. |
| `d1/d2` · scale integrity | One reset sequence adds a dropout and persistent offset to identical latent mass and machine telemetry | Eleven null samples from 12.25 to 14.75 s. On the fault arm, the last and first readings around the gap are 10.99 and 6.23 g, a −4.76 g discontinuity. Terminal indications are 49.58 and 38.37 g. The fault arm has no actual-yield annotation. | A tare or cup disturbance is consistent with the samples. A firmware reset, exact tare offset, mass through the gap and actual terminal yield need independent evidence. |
| `e1/e2` · bloom | Retained water capacity, 12 vs 30 mL | Identical command, pressure, inlet and volume. No inlet volume accumulates over the commanded 8–18 s pause. Cup mass gains 6.28 g in the first arm and 0 in the second. The t=8.00 s row carries the new command and the last inlet reading from the previous tick. At 8.25 s measured inlet is zero. | Cup carryover can coexist with zero inlet. The samples do not establish a fault or where the water was retained. |
| `f1/f2` · turbo | Target mass, 47 vs 24 g | Identical hydraulic prefix at 6 bar or below. Terminal weights cross the respective targets at 16.00 s (46.48 → 47.19 g, frame 2) and 9.25 s (23.93 → 24.87 g, frame 1). Both record `targetWeight`. The early member never enters the final frame. | The exact crossing between observations, settled post-stop yield and sensory outcome are unknown. A short recorded time is expected for this stop. |

The integrator uses 5 ms ticks, a lumped hydraulic resistance, first-order pressure response and a bounded water store. Water above the retained capacity exits into the cup. It conserves cumulative inlet volume as latent storage plus cup mass at an assumed 1 g/mL. It reports machine and scale on an aligned 0.25 s grid, with a synthetic 0.10 s slope for weight flow and fixed temperatures. A limiter is an ideal equilibrium clamp and the range is metadata. Stop samples are terminal active samples. It omits firmware-specific actuation, actual scale lag, thermal dynamics, noise, solutes and spatial extraction. The labels describe observations and abstention conditions. They supply no ground truth for espresso quality or causes in real shots.

## Production evidence

The corpus test projects typed facts and landmarks from `analyzeShot` into the
existing scorer. The score uses each label's original timing and numeric
tolerances. The [coverage snapshot](../../../test/__snapshots__/review-independent.test.ts.snap)
lists exact missing observations and figures by arm.

| Pair | Evidence reproduced within tolerance | Remaining gaps |
| --- | --- | --- |
| A | Settled hold flow, pressure and flow deficit, plus terminal scale weight | The hold summary and time near the cap lack the labelled onset times for tracking, limiter binding and inlet shortfall. |
| B | Terminal pressure and measured decline magnitude in both arms. The recorded declining command aligns with measured pressure in `b1`. | The analysis exposes a mean residual. Peak residual, measured decline onset and the onset and peak of the shortfall against the flat command remain unscored. |
| C | Configured exit value, the two pressure/time readings bracketing the handoff, stop time and final observed frame. The full arm completed its final frame and the interrupted arm did not reach it. | Cap-like time and controlled error summarize the initial phase. The first qualifying cap sample and mean over the labelled capped sample window remain unscored. |
| D | Continuous coverage and terminal indication for `d1`. Missing scale sample count for `d2`. | `d2` has no scale-gap landmark. The analysis supplies 38.37 g as `yieldG` via replay's last-weight fallback, despite the missing yield annotation. The dropout and resumption times, the downward discontinuity, and the terminal reading's reliability are uncovered. |
| E | Zero-command pause and the cup gain contrast. Terminal scale weights agree. | Production detects sustained beverage at 6.0 and 23.5 s versus first visible mass at 5.0 and 22.0 s. Restart response timing, carryover onset and peak, and pause inlet volume remain unscored. |
| F | Recorded target-weight stop, target, terminal weight, overshoot, time and frame, and whether the final frame was reached or preempted | The production facts omit the last sample before the crossing. The raw recording test verifies that all prior samples stay below the target. |

Rules and mock each execute all three available ablations across 12 cases.
`facts-only` is pending in the harness. The ablation adapter emits legacy issue
and figure IDs, yielding zero matches for these independently authored IDs.
The table above checks the typed production evidence directly. Claims about
taste, diagnosis or prose interpretation require adjudication beyond this test.
All 12 cases pass the crossed taste check. The mock gets a curve narrative
prompt for 11 recordings. For `f2`, the short recording produces no sustained
analysis window and takes the rules path across every taste input.
