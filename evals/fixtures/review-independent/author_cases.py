#!/usr/bin/env python3
"""Deterministic synthetic espresso traces: six matched pairs, standard library only.

Audit notes
- Physics integrates at 5 ms. Machine and scale samples are aligned every 0.25 s.
- Inlet volume = stored water + true cup mass (density 1 g/mL). Storage is bounded.
- Release: cup flow = k * max(0, stored - retained). A tare changes reported weight only.
- Reported weightFlow is the true mass slope over the prior 0.10 s, so tare cancels.
- A pressure exit resolves at 5 ms; the next frame's timer starts on the next sample tick.
- Weight stops are evaluated on reported samples. Timing labels are seconds from sample 0.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EPOCH = datetime(2031, 3, 4, 8, 0, tzinfo=timezone.utc)
TPS, SPS = 200, 50
H = 1.0 / TPS
TAU, Q_MAX, STORE_CAP = 0.15, 8.0, 60.0
MIX_C, GROUP_C, DOSE_G = 93.0, 92.0, 18.0
SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def ticks(seconds):
    return round(seconds * TPS)


def ramp(a, b, n, start, dur):
    return a + (b - a) * max(0.0, min(1.0, (n - start) / dur))


def step(pump, value, seconds, transition="fast", sub="pouring", exit_over=None, limiter=None):
    return {"pump": pump, "value": value, "seconds": seconds, "transition": transition,
            "sub": sub, "exit_over": exit_over, "limiter": limiter}


def simulate(steps, R, fill_ml=30.0, retained_ml=20.0, k=1.2, authority=None, target=None, stop_n=None):
    """Shared integrator; each pair's model function supplies its own parameters."""
    frame, start, prev, end = 0, 0, 0.0, ticks(steps[0]["seconds"])
    P = q = v = cup = 0.0
    n, reason, handoff = 0, None, None
    cups, samples = [0.0], []

    def command():
        s = steps[frame]
        if s["transition"] == "smooth":
            return ramp(prev, s["value"], n, start, ticks(s["seconds"]))
        return s["value"]

    def enter(next_frame, entry_n):
        nonlocal frame, start, prev, end
        prev, frame, start = steps[frame]["value"], next_frame, entry_n
        end = start + ticks(steps[frame]["seconds"])

    def record():
        s, cmd = steps[frame], command()
        samples.append({"n": n, "t": n / TPS, "P": P, "q": q, "v": v, "cup": cup,
                        "wf": (cup - cups[max(0, n - 20)]) / 0.10, "frame": frame, "sub": s["sub"],
                        "tp": cmd if s["pump"] == "pressure" else None,
                        "tf": cmd if s["pump"] == "flow" else None})

    record()
    while reason is None:
        s, cmd = steps[frame], command()
        reff = R * (0.15 + 0.85 * min(1.0, v / fill_ml))
        demand = cmd if s["pump"] == "pressure" else reff * cmd
        lim = s['limiter']
        cap = None if lim is None else (lim[0] if s['pump'] == 'flow' else lim[0] * reff)
        demand = demand if cap is None else min(demand, cap)
        if authority:
            demand = min(demand, authority(n))
        P += H * (demand - P) / TAU
        q = min(Q_MAX, P / reff) if s["pump"] == "pressure" else min(cmd, P / reff)
        out = k * max(0.0, v - cup - retained_ml)
        v += q * H
        cup += out * H
        n += 1
        cups.append(cup)
        assert 0.0 <= v - cup <= STORE_CAP
        if s["exit_over"] is not None and P > s["exit_over"]:
            handoff = n
            enter(frame + 1, -(-n // SPS) * SPS)
        elif n >= end:
            if frame == len(steps) - 1:
                reason = "machineEnded"
            else:
                enter(frame + 1, n)
        if n == stop_n:
            reason = "apiStop"
        if n % SPS == 0:
            record()
            if target is not None and round(cup, 2) >= target:
                reason = "targetWeight"
    assert n % SPS == 0 and samples[-1]["n"] == n
    return {"samples": samples, "cups": cups, "reason": reason, "handoff": handoff}


def iso(n):
    stamp = EPOCH + timedelta(milliseconds=n * 5)
    return stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def num(value, digits=3):
    return None if value is None else round(value, digits)


def step_json(i, s):
    out = {"name": f"phase-{i + 1}", "pump": s["pump"], "transition": s["transition"],
           s["pump"]: s["value"], "seconds": s["seconds"], "temperature": MIX_C}
    if s["exit_over"] is not None:
        out["exit"] = {"type": "pressure", "condition": "over", "value": s["exit_over"]}
    if s["limiter"]:
        out["limiter"] = {"value": s["limiter"][0], "range": s["limiter"][1]}
    return out


def recording(rid, tr, steps, target=None, view=None, report_yield=True):
    tag = rid[0].upper()
    view = view or (lambda s: s["cup"])
    rows = []
    for s in tr["samples"]:
        stamp, weight = iso(s["n"]), view(s)
        scale = None if weight is None else {"timestamp": stamp, "weight": round(weight, 2),
                                             "weightFlow": round(s["wf"], 3)}
        machine = {"timestamp": stamp, "pressure": num(s["P"]), "flow": num(s["q"]),
                   "mixTemperature": MIX_C, "targetPressure": num(s["tp"]), "targetFlow": num(s["tf"]),
                   "targetMixTemperature": MIX_C, "groupTemperature": GROUP_C,
                   "targetGroupTemperature": GROUP_C, "profileFrame": s["frame"],
                   "state": {"substate": s["sub"]}}
        rows.append({"machine": machine, "scale": scale, "volume": num(s["v"])})
    profile = {"title": f"Profile {tag}", "beverage_type": "espresso",
               "steps": [step_json(i, s) for i, s in enumerate(steps)]}
    context = {"beanBatchId": f"batch-{tag.lower()}", "grinderSetting": "setting-12",
               "targetDoseWeight": DOSE_G}
    if target is not None:
        profile["target_weight"] = target
        context["targetYield"] = target
    annotations = {"actualDoseWeight": DOSE_G}
    if report_yield and rows[-1]["scale"]:
        annotations["actualYield"] = rows[-1]["scale"]["weight"]
    return {"id": rid, "timestamp": iso(0), "stopReason": tr["reason"],
            "workflow": {"profile": profile, "context": context},
            "annotations": annotations, "measurements": rows}


def first(samples, cond, after=0.0):
    return next(s for s in samples if s["t"] >= after and cond(s))


def at(samples, t):
    return next(s for s in samples if s["n"] == ticks(t))


def mean(samples, key, lo, hi):
    values = [s[key] for s in samples if lo <= s["t"] <= hi]
    return sum(values) / len(values)


def raw(t, peak=None):
    lo, hi = t if isinstance(t, (tuple, list)) else (t, t)
    if not 0 <= lo <= hi:
        raise ValueError('onset outside shot')
    out = {'type': 'raw-landmark', 'onsetS': [lo, hi]}
    if peak is not None:
        out['peakS'] = [peak[0], peak[1]]
    return out

def window(lo, hi, peak=None):
    if not 0 <= lo <= hi:
        raise ValueError('onset outside shot')
    out = {'type': 'windowed-event', 'onsetS': [lo, hi]}
    if peak is not None:
        out['peakS'] = [peak[0], peak[1]]
    return out


def obs(slug, expected, var=None, phase=None, timing=None):
    out = {"id": slug, "kind": slug, "expected": expected}
    if phase:
        out["phase"] = phase
    if var:
        out["controlledVariable"] = var
    if timing:
        out["timing"] = timing
    return out


def fig(slug, unit, value, tolerance):
    return {"id": slug, "unit": unit, "value": round(value, 3), "tolerance": tolerance}


def label(family, mode, injection, observations, figures):
    for group in (observations, figures):
        ids = [item["id"] for item in group]
        assert len(ids) == len(set(ids)) and all(SLUG.match(i) for i in ids)
    return {"profileFamily": family, "pumpMode": mode,
            "labels": {"source": "synthetic-injected", "injection": injection,
                       "observations": observations, "figures": figures,
                       "supportedOutcomes": ["abstain"],
                       "forbiddenClaims": ["inferred-taste", "unqualified-diagnosis",
                                           "multiple-next-shot-changes"]}}


# Pair a: only effective hydraulic resistance changes.
def model_a(R):
    cap = (8.6, 0.6)
    steps = [step("flow", 4.5, 5, sub="preinfusion", limiter=cap), step("flow", 4.5, 25, limiter=cap)]
    return steps, simulate(steps, R, fill_ml=30.0, retained_ml=22.0, k=1.5)


def labels_a(R, tracked, tr):
    S = tr["samples"]
    flow, pressure = mean(S, "q", 10.0, 30.0), mean(S, "P", 10.0, 30.0)
    figures = [fig("hold-mean-flow", "mL/s", flow, 0.05), fig("hold-mean-pressure", "bar", pressure, 0.1),
               fig("hold-flow-deficit", "mL/s", 4.5 - flow, 0.05),
               fig("terminal-weight", "g", S[-1]["cup"], 0.5)]
    common = [obs("puck-fault-diagnosis", "forbidden"), obs("grind-change-prescription", "forbidden")]
    if tracked:
        hit = first(S, lambda s: abs(s["q"] - 4.5) <= 0.05, 1.0)
        items = [obs("flow-tracks-command", "required", "flow", hit["sub"], raw(hit["t"])),
                 obs("pressure-limiter-binding", "forbidden", "pressure"),
                 obs("inlet-below-command", "forbidden", "flow")]
        result = f"inlet holds 4.5 mL/s near {pressure:.2f} bar and the 8.6 bar limiter never binds"
    else:
        ceiling = first(S, lambda s: s["P"] >= 8.5, 1.0)
        low = first(S, lambda s: s["q"] < 4.0, 2.0)
        items = [obs("pressure-limiter-binding", "required", "pressure", ceiling["sub"], raw(ceiling["t"])),
                 obs("inlet-below-command", "required", "flow", low["sub"], raw(low["t"])),
                 obs("flow-tracks-command", "forbidden", "flow")]
        result = f"pressure holds near {pressure:.2f} bar at the limiter while inlet settles near {flow:.2f} mL/s under a 4.5 mL/s command"
    text = (f"Hidden effective resistance is {R} bar per mL/s; {result}. Expected claims are limited to "
            "command tracking and limiter state. The physical origin of the resistance and puck condition are "
            "unknowable from telemetry, so channeling, grind, and cup-quality claims are forbidden.")
    return label("allonge-high-flow", "flow", text, items + common, figures)


def pair_a():
    out = []
    for rid, R, tracked in (("a1", 0.8, True), ("a2", 2.6, False)):
        steps, tr = model_a(R)
        out.append((rid, recording(rid, tr, steps), labels_a(R, tracked, tr)))
    return out


# Pair b: a command-independent authority envelope produces identical measured telemetry.
def authority_b(n):
    return 9.0 if n < ticks(16) else ramp(9.0, 6.0, n, ticks(16), ticks(12))


def model_b(declining):
    tail = 6.0 if declining else 9.0
    steps = [step("pressure", 9.0, 6, "smooth", "preinfusion"), step("pressure", 9.0, 10),
             step("pressure", tail, 12, "smooth"), step("pressure", tail, 4)]
    return steps, simulate(steps, 4.0, fill_ml=30.0, retained_ml=22.0, authority=authority_b)


def labels_b(declining, tr):
    S = tr["samples"]
    tail = [s for s in S if s["t"] >= 16.0]
    gaps = [s["tp"] - s["P"] for s in tail]
    peak = max(gaps)
    decline = first(S, lambda s: s["P"] < 8.9, 16.0)
    figures = [fig("peak-command-gap", "bar", peak, 0.06), fig("terminal-pressure", "bar", S[-1]["P"], 0.05),
               fig("measured-decline-magnitude", "bar", mean(S, "P", 12.0, 16.0) - S[-1]["P"], 0.08)]
    items = [obs("measured-pressure-decline", "required", "pressure", "pouring", raw(decline["t"])),
             obs("pressure-tracking-failure-diagnosis", "forbidden", "pressure"),
             obs("authority-cause-identification", "forbidden", "pressure")]
    if declining:
        items += [obs('decline-matches-command', 'required', var='pressure', phase='pouring', timing=window(16.0, 16.0)),
                  obs("pressure-below-flat-command", "forbidden", "pressure")]
        result = "the prescribed decline matches the measured decline, so the envelope is not separately visible"
    else:
        onset = first(S, lambda s: s["tp"] - s["P"] >= 0.25, 16.0)
        tops = [s["t"] for s, gap in zip(tail, gaps) if gap >= peak - 0.05]
        items += [obs("pressure-below-flat-command", "required", "pressure", "pouring",
                      raw(onset["t"], (tops[0], tops[-1]))),
                  obs("decline-matches-command", "forbidden", "pressure")]
        result = f"the flat 9.0 bar command stays active while measured pressure falls up to {peak:.2f} bar below it"
    text = ("A command-independent authority envelope is 9.0 bar until 16 s, then falls linearly to 6.0 bar at 28 s, "
            f"after the measured hold; {result}. Measured telemetry is identical across this pair; only the recorded "
            "command differs. Why authority fell is unknowable from telemetry, so no tracking-failure cause may be diagnosed.")
    return label("pressure-decline", "pressure", text, items, figures)


def pair_b():
    arms = [("b1", True, *model_b(True)), ("b2", False, *model_b(False))]
    keys = [[(s["P"], s["q"], s["v"], s["cup"], s["frame"]) for s in arm[3]["samples"]] for arm in arms]
    assert keys[0] == keys[1]
    return [(rid, recording(rid, tr, steps), labels_b(declining, tr)) for rid, declining, steps, tr in arms]


# Pair c: only the external stop schedule changes.
def model_c(stop_n):
    steps = [
        step('pressure', 8.0, 20.0, sub='preinfusion', exit_over=6.4, limiter=(2.2, 0.0)),
        step('flow', 2.4, 10.0),
        step('pressure', 5.5, 8.0),
    ]
    return steps, simulate(steps, 3.6, fill_ml=26, retained_ml=18, stop_n=stop_n)


def labels_c(completed, tr):
    s = tr['samples']
    frames = sorted({x['frame'] for x in s if x['frame'] is not None})
    assert len(frames) == (3 if completed else 2)
    i = max(j for j, x in enumerate(s) if x['frame'] == frames[0])
    a, b = s[i], s[i + 1]
    end = s[-1]['t']
    assert b['frame'] == frames[1]
    assert abs(b['t'] - a['t'] - 0.25) < 1e-9
    assert a['P'] < 6.4 < b['P']  # strict on both sides: the crossing lies between graph samples
    assert a['n'] < tr['handoff'] < b['n']
    assert 0.0 <= a['t'] < b['t'] <= end
    capped = [x for x in s[:i + 1] if x['q'] >= 0.9 * 2.2]
    assert capped and all(x['q'] <= 2.2 + 0.02 and x['P'] < 8.0 for x in capped)
    cap_flow = sum(x['q'] for x in capped) / len(capped)
    if not completed:
        assert abs(end - 15.0) <= 0.25 and b['t'] < 15.0
    items = [
        obs('flow-limited-under-pressure-command', 'required', var='flow', phase='preinfusion', timing=window(capped[0]['t'], capped[0]['t'])),
        obs('pressure-below-active-command-at-flow-cap', 'required', var='pressure', phase='preinfusion', timing=window(capped[0]['t'], capped[0]['t'])),
        obs('flow-mode-handoff-bracket-consistent-with-configured-threshold', 'required', var='pressure', phase=b['sub'], timing=raw((a['t'], b['t']))),
        obs('exact-threshold-crossing-time-asserted', 'forbidden', var='pressure'),
        obs('exact-handoff-cause-asserted', 'forbidden', var='pressure'),
    ]
    if completed:
        items += [
            obs('final-frame-completed', 'required', var='time', phase='pouring', timing=raw(end)),
            obs('early-stop-reported', 'forbidden', var='time'),
        ]
    else:
        items += [
            obs('terminal-stop-before-final-frame', 'required', var='time', phase='pouring', timing=raw(end)),
            obs('final-frame-reached', 'forbidden', var='time'),
            obs('api-stop-motive-asserted', 'forbidden'),
            obs('puck-fault-inferred-from-early-stop', 'forbidden'),
        ]
    figs = [
        fig('configured-exit-threshold', 'bar', 6.4, 0.05),
        fig('handoff-bracket-lower-pressure', 'bar', round(a['P'], 2), 0.15),
        fig('handoff-bracket-upper-pressure', 'bar', round(b['P'], 2), 0.15),
        fig('handoff-bracket-lower-time', 's', round(a['t'], 2), 0.25),
        fig('handoff-bracket-upper-time', 's', round(b['t'], 2), 0.25),
        fig('sampled-flow-under-cap', 'mL/s', round(cap_flow, 2), 0.1),
        fig('last-frame-reached', 'frame', s[-1]['frame'], 0),
        fig('stop-time', 's', round(end, 2), 0.25),
    ]
    injection = ('Hidden intervention: ' + ('none; the profile runs to completion. ' if completed else 'an API stop scheduled at 15.0 s; the profile is otherwise identical to the full run. ')
        + 'Frame 1 commands 8.0 bar with a 2.2 mL/s limiter and a conditional exit above 6.4 bar (20 s maximum), then 2.4 mL/s for 10 s, then 5.5 bar for 8 s. '
        + 'Expected consequence: pressure stays short of command at the flow cap, and the first flow-mode sample follows a sample pair bracketing 6.4 bar. '
        + 'Not inferable without device events: the exact crossing time, the exact cause of the handoff, or the motive of any API stop; a terminal early stop does not establish a puck fault. '
        + 'If pressure, flow or frame channels are absent, the corresponding limiter, handoff and frame-completion claims are unsupported.')
    return label('adaptive-limiter-handoff', 'mixed', injection, items, figs)


def pair_c():
    out = []
    for rid, stop_n, completed in (("c1", None, True), ("c2", ticks(15), False)):
        steps, tr = model_c(stop_n)
        out.append((rid, recording(rid, tr, steps), labels_c(completed, tr)))
    return out


# Pair d: one physical trace is reported through a clean or reset scale view.
def model_d():
    steps = [step("pressure", 9.0, 5, "smooth", "preinfusion"), step("pressure", 9.0, 25)]
    tr = simulate(steps, 4.2, fill_ml=30.0, retained_ml=20.0)
    tare = tr["cups"][ticks(12.1)]
    assert tare > 1.0
    return steps, tr, tare


def reset_view(tare):
    def view(s):
        if 12.0 < s["t"] < 15.0:
            return None
        return s["cup"] - tare if s["t"] >= 15.0 else s["cup"]
    return view


def labels_d(clean, tr, tare):
    s = tr['samples']
    end = s[-1]['t']
    if clean:
        assert all(x['cup'] is not None for x in s)
        items = [
            obs('scale-continuous-whole-shot', 'required', var='yield', timing=window(0.0, 0.0)),
            obs('scale-dropout-reported', 'forbidden', var='yield'),
            obs('downward-scale-discontinuity-reported', 'forbidden', var='yield'),
        ]
        figs = [
            fig('scale-coverage-start', 's', round(s[0]['t'], 2), 0.25),
            fig('scale-coverage-end', 's', round(end, 2), 0.25),
            fig('scale-null-samples', 'samples', 0, 0),
            fig('terminal-scale-indication', 'g', round(s[-1]['cup'], 2), 0.05),
        ]
        injection = 'Hidden intervention: none. The scale reports continuously across the whole shot, so no scale event onset exists. Absolute calibration requires an external reference.'
        return label('classic-pressure-hold', 'pressure', injection, items, figs)
    view = reset_view(tare)
    s = [{**x, 'cup': None if view(x) is None else round(view(x), 2)} for x in s]
    nulls = [x for x in s if x['cup'] is None]
    assert nulls and abs(nulls[0]['t'] - 12.25) < 1e-9 and abs(nulls[-1]['t'] - 14.75) < 1e-9
    pre = [x for x in s if x['t'] < nulls[0]['t'] and x['cup'] is not None][-1]
    after = [x for x in s if x['t'] > nulls[-1]['t']]
    assert after and all(x['cup'] is not None for x in after)
    post = after[0]
    assert abs(post['t'] - 15.0) < 1e-9
    delta = round(post['cup'] - pre['cup'], 2)
    assert delta < 0
    items = [
        obs('scale-dropout', 'required', var='yield', timing=raw(nulls[0]['t'])),
        obs('scale-resumes-after-dropout', 'required', var='yield', timing=raw(post['t'])),
        obs('downward-discontinuity-consistent-with-tare-or-cup-change', 'required', var='yield', timing=raw(post['t'])),
        obs('terminal-scale-reading-untrusted', 'required', var='yield', timing=raw(end)),
        obs('firmware-reset-concluded', 'forbidden', var='yield'),
        obs('exact-offset-size-asserted', 'forbidden', var='yield'),
        obs('cup-dynamics-across-gap-asserted', 'forbidden', var='yield'),
        obs('true-terminal-yield-asserted', 'forbidden', var='yield'),
    ]
    figs = [
        fig('last-scale-sample-before-gap', 's', round(pre['t'], 2), 0.25),
        fig('first-scale-sample-after-gap', 's', round(post['t'], 2), 0.25),
        fig('scale-null-samples', 'samples', len(nulls), 0),
        fig('observed-scale-delta-across-gap', 'g', delta, 0.02),
        fig('untrusted-terminal-scale-reading', 'g', round(s[-1]['cup'], 2), 0.05),
    ]
    injection = (f'Hidden intervention: one scale reset sequence at 12.10 s with a persistent {tare:g} g downward offset; scale readings are null from 12.25 s to 14.75 s and resume at 15.00 s. '
        'Machine behaviour and true cup mass match the clean arm. '
        'Expected consequence: a dropout followed by a downward discontinuity consistent with a tare or cup change. '
        'Not inferable from the trace alone: a firmware reset, the offset size, cup dynamics across the gap, or the true terminal yield.')
    return label('classic-pressure-hold', 'pressure', injection, items, figs)


def pair_d():
    steps, tr, tare = model_d()
    return [("d1", recording("d1", tr, steps), labels_d(True, tr, tare)),
            ("d2", recording("d2", tr, steps, view=reset_view(tare), report_yield=False), labels_d(False, tr, tare))]


# Pair e: only retained capacity changes, setting how much stored water can drain in the pause.
def model_e(retained_ml):
    steps = [step("flow", 3.0, 8, sub="preinfusion"), step("flow", 0.0, 10, sub="preinfusion"), step("flow", 2.2, 18)]
    return steps, simulate(steps, 1.6, fill_ml=40.0, retained_ml=retained_ml, k=0.3)


def labels_e(retained_ml, carryover, tr):
    S = tr["samples"]
    gain = at(S, 18.0)["cup"] - at(S, 8.0)["cup"]
    pause = [s for s in S if 8.0 <= s["t"] <= 18.0]
    peak = max(pause, key=lambda s: s["wf"])
    cup_start = first(S, lambda s: s["cup"] >= 0.1)
    restart = first(S, lambda s: s["q"] >= 2.0, 18.0)
    zero = first(S, lambda s: s["tf"] == 0.0)
    figures = [fig("pause-cup-gain", "g", gain, 0.2), fig("pause-peak-weight-flow", "g/s", peak["wf"], 0.15),
               fig("pause-inlet-volume", "mL", at(S, 18.0)["v"] - at(S, 8.0)["v"], 0.01),
               fig("first-cup-time", "s", cup_start["t"], 0.25), fig("terminal-weight", "g", S[-1]["cup"], 0.5)]
    items = [obs("zero-flow-pause", "required", "flow", zero["sub"], raw(zero["t"])),
             obs("restart-flow-resumed", "required", "flow", restart["sub"], raw(restart["t"])),
             obs("first-cup-observed", "required", "yield", cup_start["sub"], raw(cup_start["t"])),
             obs("drip-as-fault", "forbidden", "yield"), obs("puck-fault-diagnosis", "forbidden")]
    if carryover:
        assert gain > 3.0
        items.append(obs("pause-drip-carryover", "required", "yield", "preinfusion",
                         window(8.0, 8.0, (peak["t"], peak["t"]))))
        result = f"previously stored water drains {gain:.2f} g into the cup during the zero-flow pause"
    else:
        assert gain == 0.0
        items.append(obs("pause-drip-carryover", "forbidden", "yield"))
        result = "no cup mass is added during the zero-flow pause and first cup mass appears after restart"
    text = (f"Hidden retained capacity is {retained_ml:.0f} mL with unchanged commands and timing; {result}. Drips are stored-water "
            "release, not an error. Where water is held and why its release differs are unknowable from telemetry.")
    return label("bloom-restart", "flow", text, items, figures)


def pair_e():
    out = []
    for rid, retained_ml, carryover in (("e1", 12.0, True), ("e2", 30.0, False)):
        steps, tr = model_e(retained_ml)
        out.append((rid, recording(rid, tr, steps), labels_e(retained_ml, carryover, tr)))
    return out


# Pair f: only the weight target changes.
def model_f(target):
    steps = [step("pressure", 6.0, 4, sub="preinfusion"), step("pressure", 6.0, 8), step("pressure", 4.5, 8)]
    return steps, simulate(steps, 1.6, fill_ml=24.0, retained_ml=16.0, k=1.5, target=target)


def targets_f():
    _, probe = model_f(None)
    return float(round(at(probe["samples"], 16.0)["cup"])), float(round(at(probe["samples"], 9.0)["cup"]))


def labels_f(nominal, tr, target):
    S = tr["samples"]
    last, previous = S[-1], S[-2]
    weight, before = round(last["cup"], 2), round(previous["cup"], 2)
    assert tr["reason"] == "targetWeight" and before < target <= weight and last["frame"] == (2 if nominal else 1)
    figures = [fig("target-weight", "g", target, 0.001), fig("previous-sample-weight", "g", before, 0.02),
               fig("terminal-weight", "g", weight, 0.02), fig("target-overshoot", "g", weight - target, 0.02),
               fig("terminal-frame", "frame", last["frame"], 0), fig("terminal-time", "s", last["t"], 0.25)]
    items = [obs("target-weight-stop", "required", "yield", last["sub"], raw(last["t"])),
             obs("generic-fast-shot-fault", "forbidden", "time"), obs("puck-fault-diagnosis", "forbidden")]
    if nominal:
        final = first(S, lambda s: s["frame"] == 2)
        items += [obs("planned-final-phase-reached", "required", "time", final["sub"], raw(final["t"])),
                  obs("target-truncates-plan", "forbidden", "time")]
        result = "the stop occurs after the planned final frame has begun"
    else:
        items += [obs("target-truncates-plan", "required", "time", last["sub"], raw(last["t"])),
                  obs("planned-final-phase-reached", "forbidden", "time")]
        result = "the stop truncates the plan before the planned final frame"
    text = (f"The only injected change is a {target:.0f} g target. Reported weight moves from {before:.2f} g to {weight:.2f} g at "
            f"{last['t']:.2f} s, so the first sampled crossing stops the shot; {result}. The exact crossing between samples and any "
            "post-stop drip are unknowable from telemetry, and the short time is not a fault.")
    return label("turbo-weight-stop", "pressure", text, items, figures)


def pair_f():
    nominal_target, early_target = targets_f()
    out = []
    for rid, target, nominal in (("f1", nominal_target, True), ("f2", early_target, False)):
        steps, tr = model_f(target)
        rec = recording(rid, tr, steps, target=target)
        assert rec["annotations"]["actualYield"] == rec["measurements"][-1]["scale"]["weight"]
        out.append((rid, rec, labels_f(nominal, tr, target)))
    return out


def save(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")


def main():
    cases = pair_a() + pair_b() + pair_c() + pair_d() + pair_e() + pair_f()
    assert len(cases) == 12
    for rid, rec, lab in cases:
        save(ROOT / "recordings" / f"{rid}.json", rec)
        save(ROOT / "labels" / f"{rid}.json", lab)
    print(f"wrote {len(cases)} recordings and {len(cases)} labels")


if __name__ == "__main__":
    main()
