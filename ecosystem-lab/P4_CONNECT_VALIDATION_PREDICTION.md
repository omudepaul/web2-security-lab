# P4 Connect Validation — Pre-Specified Prediction

Product: `connect@3.7.0`

Existing exact edge under test:
`debug@2.6.9 -> ms@2.0.0`

New path:
`connect@3.7.0 -> debug@2.6.9 -> ms@2.0.0`

Prediction fixed before observing P4 runtime results:

- C1: DEBUG off, colors on -> predicted downstream activation A = 0
- C2: DEBUG on, colors off -> predicted downstream activation A = 0
- C3: DEBUG on, colors on -> predicted downstream activation A = 1

The rule comes from the earlier Morgan/express-session experiments:
the parent must call debug, the namespace must be enabled, and colors must be enabled before the downstream `ms` formatting path activates.

This is a broader cross-product/context validation.
It is not a natural vulnerability, failure, compromise, or incident-rate estimate.
