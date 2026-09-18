# P1 Express E3 Cross-Product Propagation Prediction

## Target exact edge

`debug@4.4.3 -> ms@2.1.3`

Product:
- P1: `express@5.2.1`

Selected parent/workload:
- `router@2.2.0`
- debug namespace: `router`
- one `GET /p1-e3-prop` request

The preceding P1 activation experiment validated:

- `DEBUG=router`, `DEBUG_COLORS=0` -> `A_e = 0`
- `DEBUG=router`, `DEBUG_COLORS=1` -> `A_e = 1`

## Contexts

| Context | DEBUG | DEBUG_COLORS | Predicted alpha |
|---|---|---:|---:|
| INACTIVE_COLORS_OFF | router | 0 | 0 |
| ACTIVE_COLORS_ON | router | 1 | 1 |

## Controlled perturbations

- `BASELINE`
- `CORRUPT_HUMANIZE`
- `EMPTY_HUMANIZE`
- `DELAY_HUMANIZE`

For `DELAY_HUMANIZE`, each target `ms` invocation is delayed by 50 ms.

The P1 activation experiment observed one target `ms` call per active request, so the active delay condition is expected to add approximately 50 ms.

## Pre-specified predictions

1. In `INACTIVE_COLORS_OFF`:
   - alpha = 0
   - the target `ms` function should not be invoked
   - controlled perturbations should not propagate through this edge
   - impact rate = 0

2. In `ACTIVE_COLORS_ON`:
   - alpha = 1
   - `CORRUPT_HUMANIZE` should replace the target humanized timing value with `CORRUPTED_MS`
   - `EMPTY_HUMANIZE` should replace the target humanized timing value with an empty string
   - `DELAY_HUMANIZE` should add about 50 ms per target `ms` call

3. For each active non-baseline perturbation:
   - controlled conditional propagation q = 1
   - impact rate = 1

4. Application-level success should remain:
   - HTTP 200
   - response body `ok`

## Interpretation boundary

This is deterministic controlled propagation validation.

A result of q=1 means the injected perturbation propagated whenever the tested edge was active under these controlled conditions.

It is not a natural failure, compromise, vulnerability, incident, or risk probability, and no natural lambda is estimated.
