# Web2 Security Lab

## OAuth 2.0 / OpenID Connect Security Monitoring and Independent Attack Detection Using Keycloak

This repository contains a research-oriented Web2 security laboratory developed to investigate authentication security, brute-force attack detection, password spraying, identity and access management, security monitoring, and independent authentication-event analysis.

The system integrates:

- OAuth 2.0
- OpenID Connect (OIDC)
- Authorization Code Flow
- PKCE with S256
- Keycloak
- Node.js
- Express.js
- Keycloak Admin REST API
- Independent security-event analysis
- Risk scoring
- Controlled ATTACK and NORMAL experiments
- Experiment isolation
- Brute-force state reset
- Multi-user attack tracking
- Source-IP tracking
- Confusion-matrix evaluation
- Automated detector testing
- GitHub version control
- GitHub Actions CI/CD

The objective of the project is not simply to rely on Keycloak's built-in authentication protection. The laboratory adds an application-level research detection layer that analyzes authentication events, assigns risk scores, evaluates suspicious behavior, records experimental outcomes, and compares the detector's decision with evidence derived from Keycloak authentication events.

---

# 1. Research Motivation

Modern Web2 applications rely heavily on centralized authentication and identity-management infrastructure.

OAuth 2.0 and OpenID Connect are widely used to provide authentication and authorization between users, applications, and identity providers.

However, authentication systems remain exposed to threats including:

- brute-force attacks;
- password guessing;
- password spraying;
- repeated authentication failures;
- account targeting;
- credential attacks;
- suspicious activity from a common source IP;
- account lockout abuse;
- low-volume authentication attacks; and
- abnormal login behavior.

This project investigates whether authentication-event information produced by an open-source identity provider can be independently analyzed to identify suspicious authentication behavior.

Keycloak is used as the open-source Identity and Access Management platform.

The Node.js application functions as both:

1. an OAuth/OIDC-protected Web2 application; and
2. an independent security-monitoring and controlled-experiment platform.

---

# 2. Project Objectives

The main objectives are to:

1. Deploy an open-source Web2 authentication platform.
2. Build and run Keycloak in a locally controlled research environment.
3. Configure OAuth 2.0 and OpenID Connect authentication.
4. Implement Authorization Code Flow with PKCE.
5. Retrieve authentication security events from Keycloak.
6. Analyze successful and failed authentication events.
7. Detect repeated authentication failures.
8. Identify repeated attacks against individual accounts.
9. Identify failures originating from the same source IP.
10. Detect multi-account password-spraying behavior.
11. Detect Keycloak temporary account lockouts.
12. Develop an independent risk-scoring algorithm.
13. Conduct controlled ATTACK and NORMAL experiments.
14. Isolate each experiment from previous authentication activity.
15. Automatically clear previous Keycloak brute-force state.
16. Record target user(s) and source IP information.
17. Generate confusion-matrix outcomes.
18. Calculate detector-performance metrics.
19. Develop automated detector tests.
20. Integrate automated testing into GitHub Actions.
21. Maintain a reproducible research repository.
22. Establish a Web2 security baseline for future cloud-security and adaptive-security research.

---

# 3. System Architecture

The high-level architecture is:

```text
+--------------------------+
|      User / Browser      |
+------------+-------------+
             |
             | HTTP
             v
+--------------------------+
|   Node.js / Express App  |
|                          |
|  OAuth/OIDC Client       |
|  Research Dashboard      |
|  Experiment Controller   |
|  Independent Detector    |
+------------+-------------+
             |
             | OAuth 2.0 / OIDC
             | Authorization Code + PKCE
             v
+--------------------------+
|         Keycloak         |
|                          |
| Identity Provider        |
| Authentication Server    |
| Brute-Force Protection   |
| Security Event Logging   |
+------------+-------------+
             |
             | Admin REST API
             v
+--------------------------+
| Authentication Events    |
+------------+-------------+
             |
             v
+--------------------------+
| Independent Detection    |
| Engine                   |
+------------+-------------+
             |
             v
+--------------------------+
| Risk Classification      |
| LOW / MEDIUM / HIGH      |
+------------+-------------+
             |
             v
+--------------------------+
| Experiment Evaluation    |
| TP / TN / FP / FN        |
+------------+-------------+
             |
             v
+--------------------------+
| Evaluation Dashboard     |
+--------------------------+
```

---

# 4. Technology Stack

## Identity and Access Management

- Keycloak

## Authentication Protocols

- OAuth 2.0
- OpenID Connect
- Authorization Code Flow
- PKCE with S256

## Backend

- Node.js
- Express.js

## Node.js Libraries

- `express`
- `express-session`
- `openid-client`
- `dotenv`

## Testing

- Node.js built-in test runner

## Data Storage

Local JSON files are used for research-event persistence.

Examples:

```text
security-events.json
detector-experiments.json
```

## Development and Version Control

- Git
- GitHub
- GitHub Actions

---

# 5. Keycloak Research Environment

A dedicated Keycloak realm is used for the project.

Example configuration:

```text
Realm:
web2-security-lab

Application Client:
research-app

Monitoring Client:
security-monitor
```

The application communicates with Keycloak for two different purposes.

## Authentication

The `research-app` client authenticates users through OAuth 2.0 and OpenID Connect.

## Security Monitoring

The `security-monitor` client uses a service account to obtain an access token and retrieve authentication events through the Keycloak Admin REST API.

The monitoring service account uses the OAuth 2.0 client-credentials flow.

---

# 6. OAuth 2.0 / OIDC Authentication

The research application implements Authorization Code Flow with PKCE.

The authentication process is:

```text
User
 |
 v
/login
 |
 v
Generate PKCE code verifier
 |
 v
Generate S256 code challenge
 |
 v
Redirect user to Keycloak
 |
 v
User authenticates
 |
 v
Keycloak redirects to /callback
 |
 v
Authorization code exchanged for tokens
 |
 v
OIDC claims extracted
 |
 v
Authenticated application session created
```

The requested OIDC scopes are:

```text
openid profile email
```

PKCE uses:

```text
code_challenge_method = S256
```

---

# 7. Protected Application Dashboard

After successful authentication, the application displays information such as:

- username;
- email;
- user ID;
- token issue time; and
- token expiration time.

The authenticated dashboard provides access to:

- Security Detection Dashboard
- Detector Evaluation Dashboard
- Raw Keycloak Events
- Application Security Events
- Logout

---

# 8. Keycloak Security Event Monitoring

The application retrieves authentication-security events from Keycloak.

Important event types include:

```text
LOGIN
LOGIN_ERROR
USER_DISABLED_BY_TEMPORARY_LOCKOUT
```

Retrieved information can include:

- timestamp;
- event type;
- username;
- user ID;
- source IP address;
- client ID;
- authentication error; and
- event reason.

Monitoring service-account events are excluded from controlled experiment analysis so that monitoring activity does not contaminate experiment results.

---

# 9. Historical Security Analysis

The application separates successful authentication events from failed authentication events.

It also analyzes temporary-lockout events and brute-force indicators.

The historical security dashboard can display:

- total events;
- successful logins;
- failed logins;
- brute-force detections;
- temporary lockouts;
- attack user;
- source IP address; and
- recent attack information.

---

# 10. Independent Detection Engine

A central component of the project is the independent detector.

The detector evaluates authentication events generated during a controlled experiment.

Primary event types analyzed include:

```text
LOGIN_ERROR
USER_DISABLED_BY_TEMPORARY_LOCKOUT
```

The detector groups failures by:

- source IP address; and
- target username.

It calculates:

- total experiment events;
- failed login count;
- temporary lockout count;
- failures per IP;
- failures per user;
- highest failure source IP;
- highest targeted account;
- all distinct targeted accounts;
- risk score;
- risk classification;
- custom binary prediction; and
- Keycloak-derived comparison label.

---

# 11. Failed Login Threshold

The current research threshold is:

```javascript
FAILED_LOGIN_THRESHOLD = 3
```

Three or more relevant authentication failures can therefore contribute to an elevated attack classification.

The threshold is a research parameter and may be adjusted during future experiments.

---

# 12. Custom Risk-Scoring Model

The detector assigns a numerical risk score.

## Failed Login Frequency

Each failed login contributes:

```text
+10 points
```

The failed-login contribution is capped at:

```text
40 points
```

Examples:

```text
1 failed login  = 10 points
2 failed logins = 20 points
3 failed logins = 30 points
4+ failures     = maximum 40 points
```

## Repeated Source IP

If failures from the same source IP reach the configured threshold:

```text
+20 points
```

## Repeated Target User

If failures against the same user reach the configured threshold:

```text
+20 points
```

## Keycloak Temporary Lockout

If a Keycloak temporary account lockout is observed:

```text
+40 points
```

The final risk score is capped at:

```text
100
```

---

# 13. Risk Classification

The custom detector converts the numerical score into three levels.

| Risk Score | Classification |
|---|---|
| 0-29 | LOW |
| 30-59 | MEDIUM |
| 60-100 | HIGH |

For binary experimental evaluation:

```text
LOW
 |
 v
NORMAL
```

while:

```text
MEDIUM or HIGH
      |
      v
    ATTACK
```

---

# 14. Keycloak Comparison Label

The experiment framework also records a Keycloak-derived assessment.

The comparison currently considers failed-login and temporary-lockout evidence obtained from Keycloak events.

The dashboard records:

```text
Custom Prediction
Keycloak Prediction
```

and determines whether the binary decisions agree.

Important clarification:

The `Keycloak Prediction` field is a research comparison label derived from Keycloak-observed authentication events. It should not be interpreted as a native Keycloak machine-learning prediction.

---

# 15. Controlled Experiment Framework

Two controlled experiment types are supported:

```text
ATTACK
```

and:

```text
NORMAL
```

The selected experiment type becomes the experiment's:

```text
GROUND TRUTH
```

The independent detector does not use this ground-truth value when calculating its prediction.

Ground truth is used only after detection to determine whether the result is:

- True Positive;
- True Negative;
- False Positive; or
- False Negative.

---

# 16. Experiment Isolation

Experiment isolation is important because authentication activity from previous tests should not influence subsequent tests.

The framework uses two mechanisms.

## 16.1 Keycloak Brute-Force State Reset

Before each experiment begins, the application clears previous Keycloak brute-force detection state.

The experiment start timestamp is recorded only after the reset operation succeeds.

## 16.2 Experiment Start/Finish Window

Each experiment records:

```text
Experiment Start Time
Experiment Finish Time
```

Only Keycloak events occurring inside this time window are analyzed.

Conceptually:

```text
Previous Events
      X
      X

-----------------------------
EXPERIMENT START
-----------------------------

Relevant Event 1
Relevant Event 2
Relevant Event 3

-----------------------------
EXPERIMENT FINISH
-----------------------------

Future Events
      X
      X
```

Only the relevant events inside the experiment window are passed to the detector.

---

# 17. Controlled Experiment Procedure

A typical experiment follows this workflow:

```text
STEP 1
Select ATTACK or NORMAL
        |
        v

STEP 2
Clear previous Keycloak brute-force state
        |
        v

STEP 3
Record experiment start timestamp
        |
        v

STEP 4
Perform authentication activity
        |
        v

STEP 5
Finish experiment
        |
        v

STEP 6
Record experiment finish timestamp
        |
        v

STEP 7
Retrieve Keycloak events
        |
        v

STEP 8
Filter events to experiment window
        |
        v

STEP 9
Run independent detector
        |
        v

STEP 10
Generate custom prediction
        |
        v

STEP 11
Compare prediction with ground truth
        |
        v

STEP 12
Generate TP / TN / FP / FN outcome
        |
        v

STEP 13
Save experiment
        |
        v

STEP 14
Recalculate evaluation metrics
```

---

# 18. Normal Authentication Experiments

NORMAL experiments represent legitimate authentication behavior without an intentional attack sequence.

Expected detector behavior:

```text
Ground Truth = NORMAL
Prediction   = NORMAL
```

Result:

```text
TRUE NEGATIVE
```

Testing has also shown that the detector can tolerate isolated user mistakes.

For example:

```text
1 failed authentication
Risk Score = 10
Prediction = NORMAL
```

and:

```text
2 failed authentications
Risk Score = 20
Prediction = NORMAL
```

These controlled cases remain below the attack-classification threshold.

---

# 19. Improved NORMAL User and Source-IP Tracking

An important improvement was added to the experiment framework.

Previously, the detector obtained source-IP and user information primarily from `LOGIN_ERROR` events.

As a result, a completely successful NORMAL experiment containing no authentication failures could be recorded as:

```text
Source IP:   Not available
Target User: Not available
```

The framework was corrected to use the latest relevant authentication event as a fallback.

For NORMAL experiments containing successful authentication, the experiment can now record information such as:

```text
Source IP:      127.0.0.1
Target User(s): alice
```

This improves the completeness and interpretability of legitimate-authentication experiment records.

---

# 20. Brute-Force Experiments

Brute-force experiments intentionally generate repeated failed authentication attempts against the controlled research environment.

A typical repeated attack against one account can include:

```text
Target: Alice
Failed Attempts: 3
Source IP: 127.0.0.1
```

When Keycloak also produces a temporary-lockout event, the independent detector can reach:

```text
Risk Score: 100
Classification: HIGH
Prediction: ATTACK
```

When ground truth is also ATTACK, the outcome becomes:

```text
TRUE POSITIVE
```

---

# 21. Password-Spraying Experiments

Password spraying differs from conventional brute force because authentication failures are distributed across multiple accounts.

Example:

```text
Alice -> 1 failed attempt
Admin -> 1 failed attempt
Bob   -> 1 failed attempt
```

This creates:

```text
3 failed authentications
3 targeted accounts
0 individual account lockouts
```

The detector can identify the activity because the failures still originate from a common source and collectively reach the authentication-failure threshold.

---

# 22. Multi-User Target Tracking

The detector was enhanced to retain every distinct username targeted by failed-login activity.

Previously, password-spraying experiments could display only one account, such as:

```text
Target User: admin
```

even when several accounts had actually been targeted.

The updated detector maintains a distinct `targetUsers` collection and the evaluation dashboard now displays:

```text
Target User(s)
```

A verified password-spraying experiment recorded:

```text
Ground Truth:        ATTACK
Custom Prediction:   ATTACK
Risk Score:          50
Keycloak Prediction: ATTACK
Events:              3
Failures:            3
Lockouts:            0
Source IP:           127.0.0.1
Target User(s):      bob, admin, alice
State Reset:         YES
Outcome:             TRUE POSITIVE
```

This confirms that multi-account authentication attacks can now be represented accurately in the experiment history.

---

# 23. Confusion Matrix

Each completed experiment is automatically assigned one of four outcomes.

## True Positive

```text
Ground Truth = ATTACK
Prediction   = ATTACK

Outcome = TRUE POSITIVE
```

## True Negative

```text
Ground Truth = NORMAL
Prediction   = NORMAL

Outcome = TRUE NEGATIVE
```

## False Positive

```text
Ground Truth = NORMAL
Prediction   = ATTACK

Outcome = FALSE POSITIVE
```

## False Negative

```text
Ground Truth = ATTACK
Prediction   = NORMAL

Outcome = FALSE NEGATIVE
```

---

# 24. Documented 22-Experiment Baseline

A documented experimental baseline contains:

```text
22 controlled experiments
```

The recorded baseline results were:

| Metric | Result |
|---|---:|
| Total Experiments | 22 |
| True Positives | 7 |
| True Negatives | 13 |
| False Positives | 1 |
| False Negatives | 1 |
| Accuracy | 90.91% |
| Precision | 87.50% |
| Recall | 87.50% |
| F1 Score | 87.50% |
| False Positive Rate | 7.14% |
| False Negative Rate | 12.50% |

This 22-experiment dataset is retained as a documented Web2 baseline.

Additional validation experiments have subsequently been performed while improving user/IP tracking and multi-user password-spray representation.

---

# 25. Baseline Confusion Matrix

For the documented 22-experiment baseline:

| Actual / Predicted | ATTACK | NORMAL |
|---|---:|---:|
| ATTACK | TP = 7 | FN = 1 |
| NORMAL | FP = 1 | TN = 13 |

Graphically:

```text
                    PREDICTED

                 ATTACK    NORMAL

ACTUAL ATTACK       7         1

ACTUAL NORMAL       1        13
```

---

# 26. Key Experimental Findings

## Normal Authentication

Normal authentication activity can be correctly classified as NORMAL.

The detector also tolerates isolated authentication mistakes below the configured threshold.

## Repeated Authentication Attack

Repeated failed authentication attempts against the same account and source IP can produce a HIGH attack classification.

A Keycloak temporary lockout provides an additional high-confidence signal.

## Password Spraying

Three distributed failed authentications across multiple accounts can produce a MEDIUM/ATTACK classification even without an individual account lockout.

This demonstrates the value of evaluating activity across accounts rather than considering each account independently.

## Low-Volume False Negative

A controlled ATTACK experiment containing insufficient failed authentication activity can remain below the threshold.

For example:

```text
Risk Score: 10 or 20
Prediction: NORMAL
Ground Truth: ATTACK
```

This results in a:

```text
FALSE NEGATIVE
```

and demonstrates a limitation of fixed thresholds.

## False Positive Boundary

A NORMAL experiment containing enough repeated authentication failures to trigger attack rules can be classified as ATTACK.

This demonstrates the trade-off between:

- detecting malicious repeated failures; and
- tolerating repeated legitimate user mistakes.

---

# 27. Performance Metrics

The application calculates standard classification metrics automatically.

## Accuracy

```text
Accuracy =
(TP + TN) / (TP + TN + FP + FN)
```

## Precision

```text
Precision =
TP / (TP + FP)
```

## Recall

```text
Recall =
TP / (TP + FN)
```

## F1 Score

```text
F1 =
2 x (Precision x Recall)
    --------------------
    Precision + Recall
```

## False Positive Rate

```text
FPR =
FP / (FP + TN)
```

## False Negative Rate

```text
FNR =
FN / (FN + TP)
```

The metrics are calculated from stored experiment records rather than manually entered values.

---

# 28. Experiment Data Recorded

Each completed experiment can contain:

```text
Experiment ID
Start Time
Finish Time
Duration
Researcher
Ground Truth
Custom Prediction
Custom Classification
Risk Score
Keycloak Assessment
Keycloak Prediction
Detector / Keycloak Comparison
Confusion-Matrix Outcome
Number of Experiment Events
Failed Login Count
Lockout Count
Source IP
Target User
Target Users
Detection Signals
Brute-Force State Reset Status
```

`targetUser` provides a human-readable dashboard representation.

`targetUsers` preserves the underlying set of distinct failed-login targets for newer experiments.

---

# 29. Detector Evaluation Dashboard

The evaluation dashboard displays:

- recorded experiments;
- true positives;
- true negatives;
- false positives;
- false negatives;
- accuracy;
- precision;
- recall;
- F1 score;
- false-positive rate;
- false-negative rate;
- custom/Keycloak agreement;
- confusion matrix;
- experiment start and finish times;
- risk scores;
- number of events;
- number of failures;
- lockouts;
- source IP;
- target user(s);
- state-reset status; and
- experiment outcome.

---

# 30. Automated Detector Tests

The detector contains automated unit tests using the Node.js built-in testing framework.

Run:

```bash
node --test tests/detector.test.js
```

The current test suite contains eight tests:

```text
1. Only events inside experiment window are included
2. Zero failures produces LOW / NORMAL
3. One failure produces risk score 10
4. Two failures produce risk score 20
5. Three distributed failures produce MEDIUM / ATTACK
6. Three repeated failures produce HIGH / ATTACK
7. Lockout produces maximum HIGH risk
8. Confusion-matrix classification works correctly
```

Current test result:

```text
tests: 8
pass:  8
fail:  0
```

JavaScript syntax can also be validated using:

```bash
node --check index.js
```

---

# 31. GitHub Actions CI/CD

The project uses GitHub Actions to automatically validate the repository.

The CI workflow runs when changes are pushed to `main` or included in a pull request targeting `main`.

The workflow performs operations including:

```text
Checkout repository
Configure Node.js
Install dependencies with npm ci
Run node --check index.js
Run automated detector tests
Verify important project files
Confirm that .env is not committed
```

This improves reproducibility and helps prevent broken detector code from being merged into the repository.

---

# 32. Application Routes

| Route | Function |
|---|---|
| `/` | Main authenticated dashboard |
| `/login` | Begin OAuth/OIDC authentication |
| `/callback` | OAuth/OIDC callback |
| `/security-dashboard` | Security monitoring and controlled experiments |
| `/start-experiment` | Start an ATTACK or NORMAL experiment |
| `/finish-experiment` | Finish and analyze the active experiment |
| `/cancel-experiment` | Cancel active experiment |
| `/evaluation` | Detector evaluation dashboard |
| `/clear-experiments` | Clear stored experiment history |
| `/keycloak-events` | View Keycloak security events |
| `/security-events` | View application security events |
| `/logout` | Destroy application session |

---

# 33. Application Security Logging

The Node.js application maintains a security-event history separate from Keycloak's event log.

Examples include:

```text
LOGIN_SUCCESS
LOGOUT
BRUTE_FORCE_STATE_RESET
EXPERIMENT_STARTED
EXPERIMENT_FINISHED
EXPERIMENT_CANCELLED
EXPERIMENT_HISTORY_CLEARED
```

This provides an application-level audit trail.

---

# 34. Environment Variables

Create:

```text
.env
```

in the project directory.

Example:

```env
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=web2-security-lab
MONITOR_CLIENT_ID=security-monitor
MONITOR_CLIENT_SECRET=YOUR_LOCAL_SECRET
SESSION_SECRET=YOUR_RANDOM_SESSION_SECRET
```

Never commit the real `.env` file.

The public repository should contain:

```text
.env.example
```

instead.

---

# 35. Installation

Clone the repository:

```bash
git clone https://github.com/omudepaul/web2-security-lab.git
```

Enter the project:

```bash
cd web2-security-lab
```

Install dependencies:

```bash
npm install
```

---

# 36. Running the Research Environment

Keycloak must be running before the Node.js application starts.

After Keycloak is available, start the application:

```bash
node index.js
```

Expected output includes messages similar to:

```text
Research application running at http://localhost:3000
Keycloak security monitoring enabled
Independent detection engine enabled
Isolated experiment framework enabled
Keycloak brute-force state reset enabled
Failed-login threshold: 3
```

Open:

```text
http://localhost:3000
```

in a browser.

---

# 37. Development Environment

The project has been developed and tested using:

```text
Operating System:
Windows

Java:
OpenJDK 21

Node.js:
Node.js 24

Package Manager:
npm

Version Control:
Git

Identity Provider:
Keycloak
```

---

# 38. Repository Structure

```text
web2-security-lab/
|
|-- .github/
|   |
|   `-- workflows/
|       |
|       `-- ci.yml
|
|-- results/
|   |
|   `-- detector-experiments-final.json
|
|-- tests/
|   |
|   `-- detector.test.js
|
|-- .env.example
|
|-- .gitignore
|
|-- README.md
|
|-- index.js
|
|-- package.json
|
`-- package-lock.json
```

Runtime research files such as the following may also exist locally:

```text
security-events.json
detector-experiments.json
```

These files may contain experiment-specific runtime data.

---

# 39. GitHub Development Workflow

Typical development commands include:

```bash
git status
git add index.js
git add README.md
git commit -m "Describe research changes"
git push origin main
```

GitHub is used to maintain:

- source-code history;
- experiment-framework development;
- detector improvements;
- automated tests;
- documentation;
- experimental results;
- CI/CD configuration; and
- reproducibility.

---

# 40. Security Considerations

This application is a research prototype.

Important considerations include:

- experiments should target only systems owned by or explicitly authorized for testing;
- real credentials must never be committed;
- `.env` must remain excluded from version control;
- monitoring-client secrets must remain private;
- administrative permissions should follow least privilege;
- local JSON persistence is not intended as a production database;
- HTTPS should be used in production;
- production session storage should replace the default in-memory session store; and
- attack experiments should remain isolated to authorized research environments.

---

# 41. Research Limitations

Several limitations remain.

## Controlled Environment

Experiments currently run in a controlled local laboratory.

## Source-IP Diversity

Local testing frequently produces:

```text
127.0.0.1
```

which limits source-IP diversity.

## Manually Defined Risk Weights

Risk-scoring weights are manually selected research parameters.

## Fixed Threshold

The detector currently relies primarily on a fixed failed-login threshold.

Low-and-slow activity may remain below this threshold.

## Limited Attack Categories

The present detector primarily evaluates authentication-failure, brute-force, password-spraying, and lockout behavior.

## Local Persistence

Experiment records currently use JSON files instead of a research database or distributed telemetry platform.

## Keycloak Comparison

The Keycloak comparison value is derived from observed Keycloak event evidence rather than a native Keycloak attack-prediction model.

## Dataset Size

The existing controlled dataset provides a useful experimental baseline but remains substantially smaller and less diverse than production authentication datasets.

---

# 42. Future Experimental Work

Future work can include:

- expanding the controlled experiment dataset;
- password-spraying scenarios with more accounts;
- low-and-slow authentication attacks;
- distributed source-IP experiments;
- multiple-user targeting;
- multiple source IPs;
- varying authentication timing;
- temporal-window analysis;
- threshold sensitivity analysis;
- adaptive risk thresholds;
- detection-latency measurements;
- false-positive analysis;
- false-negative analysis;
- ROC analysis;
- comparison with alternative detectors;
- machine-learning-based detection;
- time-series attack detection;
- cloud deployment;
- containerized deployment;
- Kubernetes-based experimentation;
- cross-layer identity security;
- adaptive authentication defense; and
- extension beyond the current Web2 baseline.

---

# 43. Research Extension Toward Cloud Security

The current Web2 authentication laboratory provides a foundation for broader cloud-security research.

Potential extensions include:

```text
Identity Security
       +
Authentication Monitoring
       +
Independent Detection
       +
Adaptive Risk Analysis
       +
Cloud Deployment
       +
Cross-Layer Security
```

The current architecture can serve as a baseline for evaluating more advanced security mechanisms in cloud and distributed environments.

---

# 44. Reproducibility

A central objective of the project is reproducibility.

Controlled experiments use:

- explicit ground truth;
- automatic brute-force-state reset;
- timestamp-based experiment isolation;
- structured Keycloak event retrieval;
- monitoring-event exclusion;
- deterministic risk-scoring rules;
- automatic outcome classification;
- persistent experiment histories;
- automated detector tests;
- Git version control; and
- GitHub Actions CI/CD.

These mechanisms allow experiments to be repeated and detector changes to be compared systematically.

---

# 45. Current Research Status

Current implementation status:

```text
[COMPLETED] Keycloak source build and deployment
[COMPLETED] OAuth 2.0 / OIDC authentication
[COMPLETED] PKCE integration
[COMPLETED] Protected Node.js application
[COMPLETED] Keycloak event monitoring
[COMPLETED] Service-account monitoring
[COMPLETED] Brute-force event retrieval
[COMPLETED] Independent detector
[COMPLETED] Risk-scoring model
[COMPLETED] Controlled experiment framework
[COMPLETED] Experiment isolation
[COMPLETED] Keycloak brute-force-state reset
[COMPLETED] NORMAL user/IP tracking
[COMPLETED] Multi-user target tracking
[COMPLETED] Password-spraying experiment
[COMPLETED] Confusion matrix
[COMPLETED] Performance metrics
[COMPLETED] Evaluation dashboard
[COMPLETED] Automated detector tests
[COMPLETED] GitHub Actions testing
[COMPLETED] GitHub repository
[COMPLETED] Documented Web2 experimental baseline

[IN PROGRESS] Expanded authentication experiments
[IN PROGRESS] Advanced detector design
[PLANNED] Adaptive security mechanisms
[PLANNED] Cloud-security extension
```

---

# 46. Research Interpretation

The experimental framework demonstrates that authentication-event telemetry from an open-source identity provider can be analyzed independently to detect several forms of suspicious authentication activity.

The detector has demonstrated the ability to identify:

- repeated authentication failures;
- repeated account targeting;
- common-source authentication failures;
- temporary lockouts;
- conventional brute-force activity; and
- multi-account password spraying.

The experiments have also identified important limitations.

Low-volume attacks can remain below a fixed threshold, while repeated legitimate authentication mistakes can potentially cross the attack threshold.

These false-negative and false-positive boundaries are useful research findings because they motivate development of more advanced mechanisms incorporating:

- temporal context;
- adaptive thresholds;
- account diversity;
- source-IP diversity;
- behavioral history; and
- machine-learning or statistical detection.

The current implementation therefore serves as a measurable Web2 security baseline rather than a claim of production-ready attack detection.

---

# 47. Disclaimer

This project is intended solely for:

- cybersecurity research;
- controlled experimentation;
- education; and
- authorized security testing.

Attack experiments should only be conducted against systems, applications, accounts, and infrastructure that the researcher owns or has explicit authorization to test.

---

# 48. Author

**Paul Omude**

Ph.D. Student in Computer Science  
Oklahoma State University

Research areas represented by this project include:

- Cloud Security
- Web Security
- Authentication Security
- Identity and Access Management
- Security Monitoring
- Attack Detection

---

# 49. Project Status

**Active Research Project**

The Web2 authentication-security baseline, controlled experiment framework, independent detector, automated testing environment, and GitHub CI/CD pipeline are operational.

The next research stage is to expand the experimental framework and investigate more adaptive security mechanisms that improve detection of low-volume, multi-account, and cloud-based authentication threats.