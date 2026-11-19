# Independent synthetic espresso recordings

Claude Opus authored these six pairs independently of Crema's gym kernel. See the [matched pair design](design.md) for the evidence and the limits of each contrast.

Run `python3 evals/fixtures/review-independent/author_cases.py` from the repository root to regenerate all 12 Decaid-shaped traces in `recordings/` and the matching Crema label files in `labels/`. Each prefix identifies one matched pair. The suffix `1` is the nominal member. Keep both members of a pair in the same evaluation split. Give the review subject the replayed shot input only. Keep case IDs, label files, model parameters and the other member of the pair with the grader.

The authored equations use a lumped, volume-dependent hydraulic resistance and a first-order pressure response. The integrator advances in 5 ms ticks and reports every 0.25 s. Inlet enters a water store. Cup mass comes from first-order discharge of water above a retained volume, using 1 g/mL. With the pump off in the bloom step, stored water can still reach the cup. The volume counter includes inlet from the first frame. Limiter values act as ideal hard bounds on the commanded equilibrium. The recorded range is profile metadata. Controller authority, held temperature, scale clocks, scale output and weight-stop sampling are simplified.

These traces test mechanical interpretation of sampled evidence. They have no spatial puck structure, solute transport, sensory observations, pump-specific calibration, scale transport lag, random noise, or independent timing log. Tare affects reported weight only. Snapshot clocks are aligned, and weight flow is a synthetic slope over the preceding 0.10 s. Conditions between machine samples are known only to the authoring code. Weight targets are compared with reported mass on the 0.25 s clock, and recorded yield omits post-stop drips. Use the recorded pressure, flow and cup quantities separately. Inlet mL and cup g coincide only under the explicitly assumed density, storage model and intact scale.

Each label separates the injected mechanism from the findings a reviewer can support. Ground-truth bounds use the sampled machine clock. Crema's grader applies the adjacent-sample allowance for raw landmarks and ±1 s for windowed changes. Figure tolerances are absolute, in the given unit.

The runner registers these public fixtures as the `independent` dev dataset. Each
pair shares session and recipe grouping keys. Each arm is replayed in isolation.
The subject receives the recorded input without the pair identity, labels or
hidden interventions. Vitest regenerates both recordings and labels in a temporary
directory with standard-library Python 3 and compares the committed bytes.
