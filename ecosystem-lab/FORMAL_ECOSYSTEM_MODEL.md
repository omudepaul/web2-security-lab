# Formal Context-Stratified Open-Source Dependency Ecosystem Model

## 1. Purpose

This document consolidates the symbolic model developed through the single-component, shared-node, shared-edge, multi-hop path, controlled-occurrence-rate, and context-stratified experiments.

The model is intended to represent an open-source software ecosystem as a set of directed dependency graphs whose components may be shared across products.

This model does **not** equate vulnerability history, advisory counts, or controlled perturbation frequencies with natural compromise probabilities.

---

## 2. Product Dependency Graph

For each open-source product \(p\), define:

\[
G_p=(V_p,E_p)
\]

where:

- \(V_p\) is the set of package/component nodes in product \(p\).
- \(E_p\subseteq V_p\times V_p\) is the set of directed dependency edges.

For an edge:

\[
(u,v)\in E_p
\]

the direction means:

\[
u \rightarrow v
\]

where **\(u\) depends on \(v\)**.

Therefore, a failure or perturbation originating at \(v\) may propagate toward software behavior associated with \(u\), depending on runtime activation and propagation conditions.

The current studied dependency graphs are empirically acyclic, but the general symbolic framework does not require all future ecosystems to be acyclic.

---

## 3. Ecosystem Graph

For \(K\) products:

\[
\mathcal G_{\mathcal E}=\{G_1,G_2,\ldots,G_K\}
\]

and the ecosystem-level union is:

\[
G_{\mathcal E}
=
\left(
\bigcup_{p=1}^{K}V_p,
\bigcup_{p=1}^{K}E_p
\right)
\]

Exact package identity is represented by:

\[
\text{name}@\text{version}
\]

so two packages with the same name but different versions are treated as different nodes.

---

## 4. Shared Components

Let \(c\) denote a studied component, where \(c\) may be:

1. a node,
2. an edge, or
3. a dependency path.

Define the product-membership set:

\[
\mu(c)=\{p:c\in G_p\}
\]

and ecosystem topology reach:

\[
\rho_c=\frac{|\mu(c)|}{K}
\]

where \(K\) is the total number of studied products.

A high \(\rho_c\) indicates that the component is shared broadly across the studied ecosystem, but **topology reach is not itself a risk probability**.

---

## 5. Topology Presence

For product \(p\):

\[
T_c(p)=
\begin{cases}
1,& c\text{ is topologically present in }p\\
0,& \text{otherwise}
\end{cases}
\]

Topology presence only establishes structural exposure.

It does not imply runtime loading, invocation, activation, propagation, or impact.

---

## 6. Runtime Context

Let:

\[
x\in X
\]

denote execution context.

A context can include:

- workload,
- configuration,
- feature flags,
- environment variables,
- request type,
- execution mode,
- or other runtime conditions.

The experiments demonstrate that dependency activation is context-conditioned.

---

## 7. Component Activation

For component \(c\), product \(p\), and context \(x\):

\[
\alpha_c(p,x)
=
P(A_c=1\mid T_c(p)=1,p,x)
\]

where \(A_c=1\) means the studied component is functionally active during the execution.

For individual edges, runtime activation may require several intermediate conditions such as:

\[
\text{Topology}
\rightarrow
\text{Loading}
\rightarrow
\text{Parent Invocation}
\rightarrow
\text{Enabled Execution}
\rightarrow
\text{Edge Activation}
\]

depending on the dependency.

---

## 8. Multi-Hop Path Activation

For a dependency path:

\[
\mathcal P=(e_1,e_2,\ldots,e_m)
\]

the trace-level path activation indicator is:

\[
A_{\mathcal P}(t)
=
\prod_{e\in\mathcal P}A_e(t)
\]

because each edge-activation indicator is binary for a single execution trace.

At the probability level:

\[
\alpha_{\mathcal P}(p,x)
=
P\left(
\bigcap_{e\in\mathcal P}\{A_e=1\}
\mid p,x
\right)
\]

This joint path activation should be measured directly where possible.

In general:

\[
\alpha_{\mathcal P}
\neq
\prod_{e\in\mathcal P}\alpha_e
\]

unless suitable independence assumptions are justified.

---

## 9. Conditional Propagation

Let \(s\in S\) denote a perturbation/failure mode.

For component \(c\):

\[
q_c(p,x,s)
=
P(I_c=1\mid A_c=1,p,x,s)
\]

where \(I_c=1\) means a defined impact is observed.

For a path:

\[
q_{\mathcal P}(p,x,s)
=
P(I_{\mathcal P}=1\mid A_{\mathcal P}=1,p,x,s)
\]

The controlled experiments have used impacts including:

- observability corruption,
- observability suppression,
- completion suppression,
- error corruption,
- malformed behavior,
- and latency.

A controlled value such as \(q=1\) under deterministic perturbation validates the propagation mechanism in that experiment. It does **not** imply that natural failures always propagate.

---

## 10. Effective Conditional Impact

For component \(c\):

\[
\pi_c(p,x,s)
=
\alpha_c(p,x)\,
q_c(p,x,s)
\]

For path \(\mathcal P\):

\[
\pi_{\mathcal P}(p,x,s)
=
\alpha_{\mathcal P}(p,x)\,
q_{\mathcal P}(p,x,s)
\]

This separates:

1. whether the component/path is actually active, and
2. whether an active perturbation propagates into measurable impact.

---

## 11. Occurrence / Failure Term

Introduce:

\[
\lambda_c(p,x,s)
\]

as the occurrence rate or probability of the studied initiating event.

The complete component-level impact-rate model is:

\[
R_c(p,x,s)
=
\lambda_c(p,x,s)\,
\alpha_c(p,x)\,
q_c(p,x,s)
\]

For path \(\mathcal P\):

\[
R_{\mathcal P}(p,x,s)
=
\lambda_{\mathcal P}(p,x,s)\,
\alpha_{\mathcal P}(p,x)\,
q_{\mathcal P}(p,x,s)
\]

### Controlled experiments

In the current controlled experiments:

\[
\lambda_{\text{ctrl}}
\]

is an **assigned perturbation-injection probability**.

Therefore:

\[
R_{c,\text{ctrl}}
=
\lambda_{c,\text{ctrl}}
\alpha_c q_c
\]

and:

\[
R_{\mathcal P,\text{ctrl}}
=
\lambda_{\mathcal P,\text{ctrl}}
\alpha_{\mathcal P}q_{\mathcal P}
\]

These experiments validate model structure only.

They do **not** estimate natural vulnerability, failure, compromise, or incident rates.

---

## 12. Context-Stratified Ecosystem Aggregation

Let \(w_{p,x}\) be the workload/context weight for product \(p\) under context \(x\), where:

\[
w_{p,x}\ge 0
\]

and:

\[
\sum_{p,x}w_{p,x}=1
\]

Then the ecosystem-level impact rate for component \(c\) is:

\[
\boxed{
R_{\mathcal E}(c,s)
=
\sum_{p,x}
w_{p,x}
\lambda_c(p,x,s)
\alpha_c(p,x)
q_c(p,x,s)
}
\]

For a path:

\[
\boxed{
R_{\mathcal E}(\mathcal P,s)
=
\sum_{p,x}
w_{p,x}
\lambda_{\mathcal P}(p,x,s)
\alpha_{\mathcal P}(p,x)
q_{\mathcal P}(p,x,s)
}
\]

Real ecosystem weights should eventually come from operational workload or telemetry data.

Equal weighting is acceptable only as an explicitly stated controlled experimental assumption.

---

## 13. Why Global-Average Multiplication Is Generally Unsafe

In general:

\[
E[\lambda\alpha q]
\neq
E[\lambda]E[\alpha]E[q]
\]

unless suitable independence or homogeneity assumptions are justified.

Therefore, the preferred ecosystem formulation is:

\[
\sum_{p,x}
w_{p,x}
\lambda_{p,x}
\alpha_{p,x}
q_{p,x}
\]

rather than multiplying separately pooled averages.

The controlled edge-level and multi-hop path experiments both demonstrated cases where pooled multiplication produced nonzero error while the context-stratified decomposition matched the observed grouped impact rate.

---

## 14. Joint Exposure Form

Define the direct joint occurrence-and-activation term:

\[
J_c(p,x,s)
=
P(F_c=1,A_c=1\mid p,x,s)
\]

where \(F_c\) denotes occurrence/injection.

Then:

\[
R_c(p,x,s)
=
J_c(p,x,s)\,
q_c(p,x,s)
\]

This form is useful when occurrence and activation may be statistically dependent.

Similarly for a path:

\[
J_{\mathcal P}(p,x,s)
=
P(F_{\mathcal P}=1,A_{\mathcal P}=1\mid p,x,s)
\]

and:

\[
R_{\mathcal P}(p,x,s)
=
J_{\mathcal P}(p,x,s)\,
q_{\mathcal P}(p,x,s)
\]

If occurrence and activation are independent within a context, then:

\[
J_c=\lambda_c\alpha_c
\]

but independence should not be assumed without evidence.

---

## 15. Unified Component Signature

For descriptive comparison, a studied component can be represented by:

\[
\Sigma_c
=
\left(
\rho_c,
\alpha_c,
q_c,
\pi_c
\right)
\]

and once a defensible natural occurrence term becomes available:

\[
\Sigma_c^{+}
=
\left(
\rho_c,
\lambda_c,
\alpha_c,
q_c,
R_c
\right)
\]

This is a multidimensional signature, not a scalar risk score.

---

## 16. Unified Ecosystem Model

The overall symbolic system can be written as:

\[
\boxed{
\mathcal M_{\mathcal E}
=
\left(
\{G_p\}_{p=1}^{K},
C,
\mu,
X,
S,
W,
\Lambda,
\Alpha,
Q,
\Pi,
R
\right)
}
\]

where:

- \(\{G_p\}\): product dependency graphs,
- \(C\): studied nodes, edges, and paths,
- \(\mu\): product-membership mapping,
- \(X\): execution contexts,
- \(S\): perturbation/failure modes,
- \(W\): context/product weights,
- \(\Lambda\): occurrence/failure-rate terms,
- \(\Alpha\): activation functions,
- \(Q\): conditional propagation functions,
- \(\Pi\): activation-conditioned impact terms,
- \(R\): occurrence-weighted impact rates.

---

## 17. Empirical Findings Supporting the Model

The experiments conducted so far support the following structural conclusions:

1. Static dependency topology does not imply runtime activation.
2. Shared components can have different activation behavior across products and workloads.
3. Configuration gates can determine whether a downstream dependency edge is exercised.
4. Multi-hop path activation must be treated as a joint runtime event.
5. Controlled perturbations can propagate through active dependency paths while inactive path contexts remain unaffected.
6. Context-stratified aggregation is safer than multiplying pooled averages when contexts differ.
7. Controlled occurrence-rate experiments validate model decomposition but do not estimate natural incident frequencies.

---

## 18. Current Scientific Limits

The present framework should not claim:

- natural compromise probability,
- natural vulnerability exploitation probability,
- natural package failure rate,
- real-world operational workload weights,
- universal propagation probabilities,
- independence among dependency edges,
- or a validated scalar ecosystem risk score.

The current \(q\) values come mainly from controlled perturbations.

The current \(\lambda_{\text{ctrl}}\) values are assigned experimental injection probabilities.

The current sample sizes remain limited.

---

## 19. Next Extensions

The most important next extensions are:

1. obtain or define defensible natural \(\lambda\) estimates from longitudinal telemetry, incident records, or operational evidence;
2. introduce impact severity/magnitude in addition to binary impact;
3. estimate uncertainty and confidence intervals;
4. expand to more products, shared components, dependency paths, and workloads;
5. compare against topology-only and vulnerability-count baselines;
6. later introduce AI-assisted estimation or prediction only after the empirical representation is sufficiently mature;
7. later use blockchain selectively for integrity/provenance of signed or hashed evidence rather than placing raw telemetry on-chain.

---

## 20. Central Research Principle

The model separates four ideas that are often incorrectly collapsed:

\[
\boxed{
\text{Structural Exposure}
\neq
\text{Runtime Activation}
\neq
\text{Conditional Propagation}
\neq
\text{Natural Occurrence}
}
\]

The proposed ecosystem model therefore represents impact as a context-dependent interaction among:

\[
\boxed{
\text{Topology}
+
\text{Occurrence}
+
\text{Runtime Activation}
+
\text{Conditional Propagation}
}
\]

rather than treating dependency presence alone as risk.
