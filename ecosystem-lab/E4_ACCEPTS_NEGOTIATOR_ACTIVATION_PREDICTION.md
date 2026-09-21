# E4 Pre-Registered Activation Hypothesis

## Study identifier

- **Component:** E4
- **Exact dependency edge:** `accepts@1.3.8 -> negotiator@0.6.3`
- **Products:** P5 Compression and P6 Socket.IO/Engine.IO
- **Registration point:** Written before either E4 runtime activation experiment is executed
- **Scope:** Controlled runtime mechanism validation; this study does **not** estimate natural failure probability, natural incident rate, or product risk.

## Source-grounded mechanism

In both products, `accepts@1.3.8` constructs a `Negotiator` object and delegates encoding selection to `negotiator@0.6.3`.

- **P5 Compression:** An eligible response reaches `accepts(req)`, followed by `accept.encoding(['gzip', 'deflate', 'identity'])`. Earlier guards can terminate processing for a response below the compression threshold, a response that is already encoded, or a `HEAD` request.
- **P6 Engine.IO polling:** An eligible polling response reaches `accepts(this.req).encodings(['gzip', 'deflate'])`. Earlier guards terminate processing when HTTP compression is disabled, packet compression is not requested, or the payload is below the configured threshold.

This dependency family is distinct from the previously studied `debug -> ms` timing-humanization mechanism. E4 performs HTTP content-encoding negotiation.

## Variables and operational definitions

For product `p`, condition `x`, and trial `t`:

- `T_E4 = 1` when the exact edge exists in the installed dependency graph.
- `L_E4(t) = 1` when the exact `negotiator@0.6.3` module used by `accepts@1.3.8` is loaded.
- `I_parent(t) = 1` when the product invokes the relevant `accepts` encoding-selection path.
- `A_E4(t) = 1` only when an instrumented `negotiator@0.6.3` encoding-selection method is invoked through the exact `accepts@1.3.8` instance during the designated workload.
- `Y_compress(t) = 1` when the response is actually emitted with `Content-Encoding: gzip` or `deflate`.

Loading alone does not constitute activation. Likewise, E4 may activate while `Y_compress=0` if negotiation executes but selects no acceptable compression encoding.

## Primary hypotheses

### H1 — P5 Compression

E4 activates if and only if the request/response passes the upstream Compression guards and reaches the `accepts` encoding-negotiation statement.

### H2 — P6 Engine.IO polling

E4 activates if and only if the polling response has HTTP compression enabled, requests packet compression, meets the size threshold, and reaches the `accepts` encoding-negotiation statement.

### H3 — Cross-product mechanism replication

When the relevant source guards permit negotiation, the exact E4 edge activates in both P5 and P6 despite the products having different parent code, workloads, and response pipelines.

### H4 — Activation is not equivalent to compression

In an eligible request with no acceptable compression encoding, E4 will activate (`A_E4=1`) even though the response will not be compressed (`Y_compress=0`).

## Pre-specified P5 conditions

Hold the response content type compressible and keep all unmentioned settings constant.

| ID | Method and response condition | `Accept-Encoding` | Predicted `A_E4` | Predicted `Y_compress` | Rationale |
|---|---|---:|---:|---:|---|
| P5-C1 | `GET`; body above threshold; identity before middleware | `gzip` | 1 | 1 | All upstream guards pass; negotiation selects gzip. |
| P5-C2 | `HEAD`; otherwise equivalent to C1 | `gzip` | 0 | 0 | The `HEAD` guard returns before `accepts(req)`. |
| P5-C3 | `GET`; body below threshold | `gzip` | 0 | 0 | The size guard returns before negotiation. |
| P5-C4 | `GET`; body above threshold; response already encoded | `gzip` | 0 | 0 | The existing-encoding guard returns before negotiation. |
| P5-C5 | `GET`; body above threshold; identity before middleware | `identity` | 1 | 0 | Negotiation runs but selects identity/no compression. |

## Pre-specified P6 conditions

Use Engine.IO's **polling** transport, a completed polling response, and hold all unmentioned settings constant.

| ID | HTTP-compression setting | Packet `compress` option | Payload size | `Accept-Encoding` | Predicted `A_E4` | Predicted `Y_compress` | Rationale |
|---|---:|---:|---|---:|---:|---:|---|
| P6-C1 | enabled | true | at/above threshold | `gzip` | 1 | 1 | All guards pass; negotiation selects gzip. |
| P6-C2 | disabled | true | at/above threshold | `gzip` | 0 | 0 | The HTTP-compression guard returns before negotiation. |
| P6-C3 | enabled | false | at/above threshold | `gzip` | 0 | 0 | The packet-compression guard returns before negotiation. |
| P6-C4 | enabled | true | below threshold | `gzip` | 0 | 0 | The size guard returns before negotiation. |
| P6-C5 | enabled | true | at/above threshold | `identity` | 1 | 0 | Negotiation runs but finds no supported compression encoding. |

## Experimental controls

- Use the exact installed versions `accepts@1.3.8` and `negotiator@0.6.3`; abort rather than silently substituting another version.
- Use fresh child processes for trials so module cache and instrumentation state do not leak across conditions.
- Run **10 repetitions per condition** initially, matching earlier mechanism-validation experiments.
- Instrument only the `negotiator` instance resolved from the target `accepts@1.3.8` package path.
- Record module loading, `accepts` invocation, Negotiator construction, encoding-selection calls, selected encoding, response status, content encoding, payload size, fatal errors, and condition identifier.
- Verify normal response completion in every nonfatal trial.
- Do not change condition definitions, predictions, or activation criteria after inspecting results. Any necessary change becomes a separately labeled protocol amendment followed by a fresh run.

## Decision rule

The activation hypothesis passes for a product only if:

1. every valid trial matches its pre-specified `A_E4` prediction;
2. positive conditions demonstrate the exact call path from `accepts@1.3.8` to `negotiator@0.6.3`;
3. negative conditions show zero encoding-selection calls through E4, rather than merely an uncompressed response;
4. all nonfatal trials complete the intended workload; and
5. no unexpected package version or alternate `accepts`/`negotiator` copy is observed.

`Y_compress` is a secondary mechanism check and must not be substituted for `A_E4`.

## Planned order

1. Freeze and commit this prediction document.
2. Implement and run P5 activation validation.
3. Implement and run P6 activation validation.
4. Preserve raw trial data and generated summaries.
5. Only after activation validation, pre-register controlled perturbations for E4.
6. Integrate E4 into the K=6 unified ecosystem model and six-product comparison.

