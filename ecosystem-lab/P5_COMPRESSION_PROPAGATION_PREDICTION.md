# P5 Compression Propagation Validation Prediction

## Target exact shared edge

`debug@2.6.9 -> ms@2.0.0`

Product: `compression@1.7.4`

The P5 activation validation already confirmed the expected runtime gate:

- DEBUG enabled + colors off -> `A_e = 0`
- DEBUG enabled + colors on -> `A_e = 1`

## Pre-specified propagation hypothesis

Two runtime contexts are used:

| Context | DEBUG | DEBUG_COLORS | Predicted A_e |
|---|---|---:|---:|
| INACTIVE_COLORS_OFF | compression | 0 | 0 |
| ACTIVE_COLORS_ON | compression | 1 | 1 |

Four controlled conditions are used:

- `BASELINE`
- `CORRUPT_HUMANIZE`
- `EMPTY_HUMANIZE`
- `DELAY_HUMANIZE`

Predictions made before observing P5 propagation results:

1. In `INACTIVE_COLORS_OFF`, the exact edge is not activated. Therefore the perturbations should have no downstream effect through this edge.
2. In `ACTIVE_COLORS_ON`, the exact edge is activated.
3. Under active deterministic perturbation:
   - `CORRUPT_HUMANIZE` should alter the `ms` output used by debug.
   - `EMPTY_HUMANIZE` should suppress that humanized timing output.
   - `DELAY_HUMANIZE` should add approximately 50 ms to the exercised debug path.
4. For each active non-baseline perturbation, predict:
   - `q_e = 1`
   - `pi_e = alpha_e * q_e = 1`
5. HTTP service behavior is expected to remain successful because the perturbation targets the debug observability/timing path rather than compression correctness.

## Interpretation boundary

This is a deterministic controlled mechanism validation.

`q_e = 1` here does **not** mean that natural failures, vulnerabilities, compromises, or incidents occur with probability 1.

No natural `lambda` is estimated.
