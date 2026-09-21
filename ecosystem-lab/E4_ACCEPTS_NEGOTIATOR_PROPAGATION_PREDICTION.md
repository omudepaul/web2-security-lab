# E4 Pre-Registered Controlled-Propagation Prediction

## Study identifier

- **Component:** E4
- **Exact dependency edge:** `accepts@1.3.8 -> negotiator@0.6.3`
- **Products:** P5 `compression@1.7.4` and P6 `socket.io@4.8.1` / `engine.io@6.6.10`
- **Registration point:** Written after the pre-registered P5 and P6 activation validations passed, but before any E4 propagation implementation or propagation result is produced
- **Scope:** Controlled runtime mechanism validation only

This study does **not** estimate a natural vulnerability, failure, compromise, incident probability, or product risk. The natural occurrence term remains latent. Every occurrence rate in this protocol is an assigned experimental value denoted by `lambda_ctrl`.

## Evidence available before this registration

The activation study established the following without an E4 propagation perturbation:

- P5: 50 valid trials, zero fatal trials, and perfect agreement with all pre-specified activation and compression-outcome predictions.
- P6: 50 valid trials, zero fatal trials, and perfect agreement with all pre-specified activation and compression-outcome predictions.
- In both products, an eligible large response with `Accept-Encoding: gzip` activated the exact edge and produced gzip compression.
- In both products, the below-threshold guard prevented invocation of the exact edge.
- In both products, the identity-only condition activated the edge without producing compression, confirming that activation is not equivalent to the product outcome.

These results justify the active and inactive contexts below. They are not propagation results.

## Source-grounded mechanism

`accepts@1.3.8` constructs the exact `negotiator@0.6.3` object and obtains the preferred encoding from `Negotiator.prototype.encodings(availableEncodings)`.

- P5 calls `accept.encoding(['gzip', 'deflate', 'identity'])` after its response guards pass. A false/identity choice produces an uncompressed response; gzip or deflate creates the corresponding zlib stream.
- P6 polling calls `accepts(this.req).encodings(['gzip', 'deflate'])` after its HTTP-compression, packet-compression, and size guards pass. A false choice produces an uncompressed response; gzip or deflate creates the corresponding zlib stream.

The perturbation will wrap only the `negotiator` module resolved by the exact target `accepts@1.3.8` instance. No package file will be edited in place.

## Variables and operational definitions

For product `p`, runtime context `x`, perturbation `s`, and trial `t`:

- `T_E4 = 1` when the exact edge exists in the installed dependency graph.
- `A_E4(t) = 1` when `Negotiator.prototype.encodings` is invoked through the exact target `accepts@1.3.8` instance.
- `J_E4(t) = 1` when the assigned non-baseline perturbation is actually injected during that exact active call.
- `P_E4(t) = 1` when the injected perturbation produces its pre-specified measurable downstream effect.
- `q_E4(p,x,s) = Pr(P_E4=1 | A_E4=1, J_E4=1)` in the controlled trials.
- `pi_E4(p,x,s) = alpha_E4(p,x) * q_E4(p,x,s)`.
- `R_E4,ctrl(p,x,s) = lambda_E4,ctrl * alpha_E4(p,x) * q_E4(p,x,s)`.

The denominator for `q_E4` contains only trials in which the exact edge activated and the perturbation was assigned and injected. Baseline trials and inactive trials are not placed in that denominator.

## Fixed runtime contexts

The same two contexts are used in each product.

| Context | Payload | Compression settings | `Accept-Encoding` | Predicted `A_E4` |
|---|---|---|---|---:|
| `INACTIVE_BELOW_THRESHOLD` | Below 1024 bytes | Enabled; P6 packet `compress=true` | `gzip` | 0 |
| `ACTIVE_ELIGIBLE_GZIP` | At/above 1024 bytes | Enabled; P6 packet `compress=true` | `gzip` | 1 |

All unmentioned request, response, content-type, and transport settings remain identical to the successful activation-validation workloads.

## Phase A: deterministic perturbation mechanisms

### Conditions

| Condition | Exact-edge behavior | Intended mechanism |
|---|---|---|
| `BASELINE` | Call the original `encodings` implementation unchanged | Matched reference |
| `EMPTY_ENCODINGS` | Replace the exact call result with `[]` | Semantic suppression of an otherwise acceptable encoding |
| `FORCE_DEFLATE` | Replace the exact call result with `['deflate']` | Semantic substitution of the selected encoding |
| `DELAY_ENCODINGS` | Delay the exact call by 25 ms, then return its original result | Timing propagation without changing encoding semantics |

Each product/context/condition cell will contain 10 fresh-process repetitions: `2 products x 2 contexts x 4 conditions x 10 = 160` planned Phase-A trials.

### Pre-specified predictions

For both P5 and P6:

| Context | Condition | Predicted activation | Predicted injection | Predicted response | Predicted controlled propagation |
|---|---|---:|---:|---|---:|
| Inactive | `BASELINE` | 0 | 0 | HTTP 200, uncompressed | 0 |
| Inactive | `EMPTY_ENCODINGS` | 0 | 0 | Same as inactive baseline | 0 |
| Inactive | `FORCE_DEFLATE` | 0 | 0 | Same as inactive baseline | 0 |
| Inactive | `DELAY_ENCODINGS` | 0 | 0 | Same as inactive baseline; no injected delay | 0 |
| Active | `BASELINE` | 1 | 0 | HTTP 200 with gzip | 0 |
| Active | `EMPTY_ENCODINGS` | 1 | 1 | HTTP 200 without gzip/deflate | 1 |
| Active | `FORCE_DEFLATE` | 1 | 1 | HTTP 200 with deflate and a valid decompressed body | 1 |
| Active | `DELAY_ENCODINGS` | 1 | 1 | HTTP 200 with gzip and 25 ms injected at the exact call | 1 |

For every active non-baseline Phase-A condition, predict `q_E4=1`. For the active workload, predict `alpha_E4=1` and therefore `pi_E4=1`. For the inactive workload, the perturbation must remain unapplied because the exact edge is not invoked.

### Product-visible impact rules

- `EMPTY_ENCODINGS`: `P_E4=1` only when the exact perturbation is injected and the response is successfully emitted without gzip/deflate instead of the matched active-baseline gzip response.
- `FORCE_DEFLATE`: `P_E4=1` only when the exact perturbation is injected, the response declares deflate, and decompression recovers the original payload.
- `DELAY_ENCODINGS`: `P_E4=1` only when the exact perturbation is injected, at least 25 ms of controlled delay is recorded at the target call, and the response completes with the baseline gzip semantics. Mean end-to-end latency delta versus the matched baseline will be reported as a secondary magnitude measurement, not used alone to decide activation.

P6 must additionally report that its polling-write callback completes exactly once. Both products must verify the response body after decompression or identity handling.

## Phase B: assigned controlled-lambda experiment

Phase B uses only the `ACTIVE_ELIGIBLE_GZIP` context and the `EMPTY_ENCODINGS` perturbation because its downstream effect is unambiguous: matched baseline is gzip, while propagated perturbation is uncompressed.

Assigned rates:

`lambda_ctrl in {0.00, 0.25, 0.50, 0.75, 1.00}`

For each product and each assigned rate:

- Run 40 fresh-process trials.
- Assign exactly `40 * lambda_ctrl` trials to injection.
- Create the schedule before executing outcomes, using a deterministic seeded shuffle with the documented seed `E4-LAMBDA-2026` and separate product/rate labels.
- Preserve the complete schedule in the result JSON.

This produces `2 products x 5 rates x 40 = 400` planned Phase-B trials.

### Phase-B predictions

Because the workload is pre-validated as active, predict:

- `alpha_E4 = 1` at every assigned rate;
- `q_E4 = 1` among assigned-and-injected trials;
- no impact among non-injected trials;
- `R_E4,ctrl = lambda_ctrl`; and
- observed impact counts of `0`, `10`, `20`, `30`, and `40` out of 40 for the five assigned rates in each product.

The experiment will report assigned injection rate, realized exact injection count, activation rate, conditional `q`, overall controlled impact rate, response-encoding rates, body-integrity rate, and Wilson intervals. Wilson intervals describe the controlled sample only and are not natural-risk intervals.

## Primary hypotheses

1. **Runtime gating:** A structurally present but inactive exact edge blocks all three perturbation mechanisms.
2. **Semantic suppression:** In the active context, `EMPTY_ENCODINGS` propagates to removal of HTTP compression in both products.
3. **Semantic substitution:** In the active context, `FORCE_DEFLATE` propagates to a valid deflate response in both products.
4. **Timing propagation:** In the active context, `DELAY_ENCODINGS` preserves gzip semantics while adding the controlled delay at the exact edge.
5. **Cross-product replication:** The three mechanisms propagate through the same exact edge in P5 and P6 despite different parent product code and response pipelines.
6. **Controlled-rate structure:** With active workloads and deterministic downstream propagation, the controlled impact rate follows the assigned `lambda_ctrl` according to `R_ctrl=lambda_ctrl*alpha*q`.

## Instrumentation and controls

- Abort on any mismatch from `compression@1.7.4`, `socket.io@4.8.1`, `engine.io@6.6.10`, `accepts@1.3.8`, or `negotiator@0.6.3`.
- Use a fresh child process for every trial.
- Restrict interception to `require('negotiator')` whose parent is the exact target `accepts@1.3.8/index.js`.
- Record module loading, Accepts construction/invocation, Negotiator construction, exact encoding-selection calls, original and perturbed results, perturbation assignment and injection, response status, content encoding, raw and decoded body sizes, body integrity, elapsed time, injected delay, fatal errors, and condition identifiers.
- Keep payloads, threshold, headers, and compression configuration fixed within each matched context.
- Preserve raw per-trial JSON/CSV data, aggregate CSV, machine-readable report JSON, and a text report.
- Do not edit installed dependency source files.

## Decision rules

Phase A passes only if:

1. all 160 planned trials are valid and complete the intended workload;
2. every activation prediction is correct;
3. inactive contexts have zero exact-edge calls, zero injections, and zero perturbation-attributed effects;
4. active baselines produce gzip with valid bodies;
5. each active non-baseline condition produces its exact pre-specified effect in every trial;
6. `q_E4=1` for every active deterministic perturbation in both products; and
7. response integrity and P6 callback-once checks pass.

Phase B passes only if:

1. all 400 planned trials are valid;
2. realized assignment counts equal the frozen schedule;
3. the edge activates in every trial;
4. every assigned injection produces the pre-specified uncompressed impact;
5. no non-injected trial produces that impact;
6. `q_E4=1` for both products at every nonzero assigned rate; and
7. observed controlled impact rates equal their assigned `lambda_ctrl` values.

Any implementation defect or necessary protocol change must be documented as a separately committed amendment before a fresh run. Predictions must not be revised after observing propagation results.

## Planned execution order

1. Freeze and commit this prediction document.
2. Implement the P5 Phase-A deterministic propagation experiment.
3. Run, review, preserve, and commit the P5 Phase-A evidence.
4. Implement the P6 Phase-A deterministic propagation experiment.
5. Run, review, preserve, and commit the P6 Phase-A evidence.
6. Implement the pre-specified Phase-B controlled-lambda schedule.
7. Run, review, preserve, and commit Phase-B evidence for P5 and P6.
8. Integrate E4 into the unified K=6 model and six-product comparison only after the propagation evidence is complete.
