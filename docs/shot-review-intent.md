# Shot review intent

The review should feel like a good barista looking at your shot just after you
pull it. Aim for useful insight, with numbers where they explain a large miss
or make a key point clearer.

- Explain how the shot went against the plan, stage by stage, in plain language.
- Say what might explain it. Use wording like “this fits” or “could mean” and
  keep the cause open.
- Connect the owner's taste notes to that reading. “You said it was slightly
  sour, which fits the fast fill” is useful. Say when the taste points another
  way. Bring in past shots only when they help explain this one.
- End with one concrete next-shot recommendation, such as changing grind,
  yield or temperature, or checking puck prep.

## How the review works

Read the curve first and settle the mechanical observations before looking at
taste. Taste can help interpret those observations without biasing the curve
reading. Code can compute facts and verdicts for the prompt. The prompt should
shape the model's response with a format contract and a worked example.

Apply the model's wording slot by slot. Number or wording precision must never
be a pass/fail test for the model's prose. For a returned answer, fall back to
the rules summary only if the answer cannot be parsed into the agreed format.
Whenever that happens, log what the model returned with private text redacted.

v0.8.0 shipped a validator that rejected real model wording, causing reviews on
the NAS to fall back to templated text. v0.8.1 replaced it with prompt-first,
slot-by-slot wording. Keep that pass/fail gate out of the live review.

The prompts and review flow are in [review.ts](../server/recommend/review.ts).
The rules summary and taste follow-up are assembled in
[review-local.ts](../server/recommend/review-local.ts).

## The gym

The [shot review gym](../evals/README.md) scores reviews offline to improve the
prompt. It can measure usefulness. Gym results must never become a runtime gate
or block a live review.
