# 0007: Field Value Ownership After Mount

## Status

Accepted

## Decision

A control rendered by a view is uncontrolled once it exists in the DOM. `value`, `checked`,
and `selected` write only when the declared prop changes between renders. A re-render that
does not change the declared value leaves the DOM alone, so typed text and toggled controls
survive unrelated model updates.

A field that must mirror the model uses `controlledValue` instead of `value`. The runtime
compares the live DOM value against the declared value on every patch, so a value the
program rejected is written back. `controlledValue` is the opt-in for validation and
normalization on input; ordinary server-rendered fields keep `value`.

`<select>` is the exception for both props. Its declared value is applied after its children
patch and compared against the live selection, because replacing an option list can reset the
browser selection even when the declared value did not change.

## Rationale

Hypertea serves server-rendered islands. The server writes the initial field state into the
HTML and the program owns the rest of the page, so the DOM is the source of truth for what the
user typed. Forcing every declared value back on every render loses that input whenever an
unrelated model update re-renders the field, which is easy to hit: a submit flag, a loading
flag, or a route error all re-render whole forms.

The alternative, keeping `value` controlled and adding a separate initial-value prop, would
require every server-rendered field in the host application to change. It also makes the
common case the surprising one, because most fields here are server-rendered and uncontrolled.

Validation still needs the controlled behavior. A program that rejects input returns a state
whose field value is unchanged, and it relies on the runtime to put the model value back into
the DOM. `controlledValue` names that intent instead of inferring it from a live-value
comparison applied to every field.

## Constraints

- Keep the public surface to one extra prop. Do not add a third value prop.
- Do not infer controlled behavior from an event binding or from a `name` attribute.
- Keep the runtime small enough to read in one sitting.
- Preserve 100 percent statement, branch, function, and line coverage.
- Keep the host application migration mechanical: `value` keeps its name and gains
  uncontrolled semantics, and only fields that validate on input change to `controlledValue`.

## Acceptance Criteria

- A re-render that does not change `value`, `checked`, or `selected` leaves the user's typed
  text, toggle, and selection in place.
- A changed declared prop still writes to the DOM.
- `controlledValue` writes the model value back over a value the user typed.
- A `<select>` applies its declared value after its options change.
- The normal project check passes, including the host application interaction tests.
