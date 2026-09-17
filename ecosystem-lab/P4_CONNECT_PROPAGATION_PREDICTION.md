# P4 Connect Propagation Validation — Pre-Specified Prediction

Product:
`connect@3.7.0`

Exact reused edge:
`debug@2.6.9 -> ms@2.0.0`

Path:
`connect@3.7.0 -> debug@2.6.9 -> ms@2.0.0`

Prediction fixed before observing the P4 propagation results:

- Inactive context: `DEBUG=connect:dispatcher`, colors off -> path activation `A=0`.
  Controlled perturbations should produce no downstream impact.

- Active context: `DEBUG=connect:dispatcher`, colors on -> path activation `A=1`.
  For deterministic controlled perturbations:
  - `CORRUPT_HUMANIZE` -> observability corruption
  - `EMPTY_HUMANIZE` -> observability suppression
  - `DELAY_HUMANIZE` -> latency increase

For the active deterministic perturbations, the expected controlled conditional propagation is `q=1`.

This is cross-product mechanism validation in a new parent-product environment.
It is not a natural failure, vulnerability, compromise, or incident-rate estimate.
