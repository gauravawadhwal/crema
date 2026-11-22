# Shot review intent

The shot review exists to tell the person who just pulled a shot something they could not easily see themselves, and to leave them knowing what to try next. Judge any change to it by that: did the review get more insightful and more useful to a home barista, not did it get more correct-looking or more checkable.

## What a good review does

Think of a barista who watched the shot with you:

- Says how it went against the plan, in plain stage-level language. Numbers appear only where a miss is large or a point is key.
- Offers a reason, hedged. It is a hypothesis, never a diagnosis.
- Ties your taste notes back to those hypotheses ("slightly sour fits the early fill") and says so when taste points the other way.
- Mentions earlier shots only when they explain this one.
- Ends with one concrete thing to try: grind, yield, temperature, or check puck prep.

## Principles that should survive refactors

- **The prompt carries the quality.** Shape the answer with a clear format contract and a worked example. Do not try to guarantee quality by checking the output afterwards.
- **Never discard the model's answer over wording or number precision.** A rejected answer silently becomes templated text, which is the worst outcome for the reader, and strict checks reject legitimate wording often. The only acceptable fallback is an answer that cannot be parsed at all, and it must log what the model returned so the cause can be diagnosed.
- **Read the curve before taste.** Taste is used to interpret the curve afterwards, so it cannot bias the reading of what happened.
- **Code can supply facts to the prompt; it does not police the prose.**
- **The gym is offline.** It exists to improve the prompt over time and may measure usefulness. It must never become a gate on a live review.

## When you are unsure

Prefer the change that makes the review say something more useful over the one that makes it safer to assert. If a safeguard would make the review blander or more often templated, it is probably the wrong tool; improve the prompt instead.
