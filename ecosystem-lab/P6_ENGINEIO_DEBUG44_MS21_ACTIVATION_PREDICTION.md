# P6 Socket.IO / Engine.IO Version-Generalization Activation Prediction

## Target exact edge

`debug@4.4.3 -> ms@2.1.3`

Product environment:

- P6: `socket.io@4.8.1`
- Parent package selected for the first version-generalization experiment: `engine.io@6.6.10`
- Physical debug instance: `node_modules/engine.io/node_modules/debug`
- Shared `ms` target: `ms@2.1.3`

## Why this experiment is stronger than the earlier E1 validation

Earlier experiments validated:

`debug@2.6.9 -> ms@2.0.0`

P6 tests a different package-version pair:

`debug@4.4.3 -> ms@2.1.3`

The source inspection completed before runtime experimentation showed that `debug@4.4.3` assigns:

`createDebug.humanize = require('ms')`

and calls `humanize(this.diff)` only inside the `useColors` branch.

Therefore the pre-specified activation rule is:

`A_e ~= D AND E AND C`

where:

- `D`: an Engine.IO debug logger is invoked,
- `E`: the selected `engine` namespace is enabled,
- `C`: colors are enabled,
- `A_e`: the target `debug@4.4.3 -> ms@2.1.3` edge is actually invoked.

## Pre-specified configurations

| Config | DEBUG | DEBUG_COLORS | Predicted A_e |
|---|---|---:|---:|
| C1_DEBUG_OFF_COLORS_ON | off | 1 | 0 |
| C2_DEBUG_ON_COLORS_OFF | engine | 0 | 0 |
| C3_DEBUG_ON_COLORS_ON | engine | 1 | 1 |

10 independent worker runs are planned for each configuration, for 30 total trials.

## Workload

Each worker starts a Socket.IO server and sends one Engine.IO polling handshake request to:

`/socket.io/?EIO=4&transport=polling`

Expected service behavior:

- HTTP status 200
- Engine.IO open packet returned
- target Engine.IO debug logger invoked by the request path

## Interpretation boundary

This experiment tests runtime activation of a structurally present dependency edge.

It does not estimate:

- natural failure probability,
- compromise probability,
- vulnerability probability,
- natural `lambda`,
- product risk.

A successful result would support version-level mechanism generalization from
`debug@2.6.9 -> ms@2.0.0`
to
`debug@4.4.3 -> ms@2.1.3`
under the tested Engine.IO context.
