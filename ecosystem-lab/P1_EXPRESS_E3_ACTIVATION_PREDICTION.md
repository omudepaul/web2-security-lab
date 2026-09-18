# P1 Express E3 Cross-Product Activation Prediction

## Target exact edge

`debug@4.4.3 -> ms@2.1.3`

Product:
- P1: `express@5.2.1`

Selected parent context:
- `router@2.2.0`
- namespace: `router`

Static source inspection performed before runtime testing showed:
- `router/index.js` creates `require('debug')('router')`
- request dispatch calls `debug('dispatching %s %s', req.method, req.url)`

The already inspected `debug@4.4.3` source calls `humanize(this.diff)` only in the `useColors` branch.

Therefore the pre-specified runtime rule is:

`A_e ~= D AND E AND C`

where:
- `D`: router debug logger is invoked by the request,
- `E`: namespace `router` is enabled,
- `C`: debug colors are enabled,
- `A_e`: `debug@4.4.3 -> ms@2.1.3` is invoked.

## Pre-specified configurations

| Config | DEBUG | DEBUG_COLORS | Predicted A_e |
|---|---|---:|---:|
| C1_DEBUG_OFF_COLORS_ON | off | 1 | 0 |
| C2_ROUTER_ON_COLORS_OFF | router | 0 | 0 |
| C3_ROUTER_ON_COLORS_ON | router | 1 | 1 |

10 independent worker runs per configuration; 30 total.

## Workload

Each worker:
1. creates a minimal Express app,
2. registers `GET /p1-e3`,
3. starts a local HTTP server,
4. resets runtime counters after setup,
5. sends one GET request to `/p1-e3`.

Expected service behavior:
- HTTP 200
- response body `ok`

## Interpretation boundary

This is runtime activation validation of a structurally present exact dependency edge.

A successful result would provide cross-product validation of the same exact edge already tested in P6 Socket.IO.

It does not estimate natural failure, compromise, vulnerability, incident, or risk probability.
