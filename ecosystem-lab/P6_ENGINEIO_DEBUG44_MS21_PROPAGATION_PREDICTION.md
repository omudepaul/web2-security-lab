# P6 Engine.IO Version-Generalization Propagation Prediction

## Target exact edge
`debug@4.4.3 -> ms@2.1.3`

Environment:
- P6: `socket.io@4.8.1`
- Parent: `engine.io@6.6.10`

Validated activation contexts:
- `DEBUG=engine`, `DEBUG_COLORS=0` -> `A_e = 0`
- `DEBUG=engine`, `DEBUG_COLORS=1` -> `A_e = 1`

Controlled conditions:
- `BASELINE`
- `CORRUPT_HUMANIZE`
- `EMPTY_HUMANIZE`
- `DELAY_HUMANIZE`

Pre-specified predictions:
1. INACTIVE_COLORS_OFF: edge inactive, so perturbations should not propagate through this edge.
2. ACTIVE_COLORS_ON: edge active.
3. Under active non-baseline perturbations, predict controlled `q_e = 1` and impact rate = 1.
4. Delay perturbation injects 10 ms per target `ms` invocation. The prior activation experiment observed about 8 target `ms` calls per handshake, so roughly 80 ms additional latency is expected if the same call count recurs.
5. HTTP 200 and Engine.IO open-packet behavior should remain successful.

Interpretation boundary:
This is deterministic controlled mechanism validation only. `q_e = 1` is not a natural failure, compromise, vulnerability, or incident probability. No natural `lambda` is estimated.
