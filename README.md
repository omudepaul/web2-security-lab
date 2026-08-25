# Web2 Security Lab

## OAuth 2.0 / OpenID Connect Security Monitoring and Independent Attack Detection Using Keycloak

This repository contains a research-oriented Web2 security laboratory developed to investigate authentication security, brute-force attack detection, identity and access management, and independent security-event analysis.

The system integrates:

- OAuth 2.0
- OpenID Connect (OIDC)
- PKCE
- Keycloak
- Node.js
- Express
- Keycloak Admin REST API
- Independent attack detection
- Controlled security experiments
- Risk scoring
- Confusion-matrix evaluation
- GitHub version control and CI/CD

The objective of the project is not simply to rely on Keycloak's built-in protection mechanisms, but to build an additional research detection layer that independently analyzes authentication activity and evaluates whether suspicious behavior should be classified as an attack.

---

# 1. Research Motivation

Modern Web2 applications rely heavily on centralized authentication and identity-management infrastructure.

OAuth 2.0 and OpenID Connect are widely used to provide secure authentication and authorization between applications and identity providers.

However, authentication systems continue to face threats including:

- brute-force attacks;
- repeated password guessing;
- credential attacks;
- account targeting;
- repeated authentication failures;
- malicious authentication activity from a single source;
- account lockout abuse; and
- abnormal login behavior.

This project investigates whether authentication-event information produced by an open-source identity provider can be used by an independent detector to identify suspicious authentication behavior.

Keycloak is used as the underlying open-source Identity and Access Management platform.

The Node.js application acts as both:

1. an OAuth/OIDC-protected application; and
2. an independent security-monitoring and experimental platform.

---

# 2. Project Objectives

The main objectives of this project are to:

1. Deploy an open-source Web2 authentication platform.

2. Configure OAuth 2.0 and OpenID Connect authentication.

3. Implement Authorization Code Flow with PKCE.

4. Retrieve authentication security events from Keycloak.

5. Analyze failed and successful authentication activity.

6. Detect repeated authentication failures.

7. Identify repeated attacks against the same user.

8. Identify repeated failures originating from the same source IP.

9. Detect Keycloak temporary account lockouts.

10. Develop an independent risk-scoring algorithm.

11. Conduct controlled ATTACK and NORMAL experiments.

12. Prevent previous experiments from contaminating subsequent experiments.

13. Compare independent detector results with Keycloak behavior.

14. Generate confusion-matrix outcomes.

15. Calculate security-detector performance metrics.

16. Build a reproducible framework for future Web2 and cloud-security research.

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

## Data Storage

Local JSON files are currently used for research-event persistence.

Examples include:

```text
security-events.json
detector-experiments.json
```

## Development and Version Control

- Git
- GitHub
- GitHub Actions

---

# 5. Keycloak Environment

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

### Authentication

The `research-app` client is used to authenticate users through OAuth 2.0 / OpenID Connect.

### Security Monitoring

The monitoring client obtains a service-account access token and retrieves Keycloak events through the Admin API.

The application uses the OAuth client-credentials flow for the monitoring service account. :contentReference[oaicite:2]{index=2}

---

# 6. OAuth 2.0 / OIDC Authentication

The research application implements the Authorization Code flow with PKCE.

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
Authenticated session created
```

The requested OIDC scopes are:

```text
openid profile email
```

PKCE uses:

```text
code_challenge_method = S256
```

The application's implementation generates a PKCE verifier and challenge before redirecting the user to Keycloak. :contentReference[oaicite:3]{index=3}

---

# 7. Protected Application Dashboard

After successful authentication, the application displays authenticated user information such as:

- username;
- email;
- user ID;
- token issue time; and
- token expiration time.

The dashboard also provides access to:

- Security Detection Dashboard
- Detector Evaluation Dashboard
- Raw Keycloak Events
- Application Security Events
- Logout

---

# 8. Keycloak Security Event Monitoring

The application retrieves authentication security events from Keycloak.

Security events can include:

```text
LOGIN
LOGIN_ERROR
USER_DISABLED_BY_TEMPORARY_LOCKOUT
```

Information retrieved can include:

- timestamp;
- event type;
- username;
- user ID;
- source IP address;
- client ID;
- authentication error; and
- event reason.

---

# 9. Historical Security Analysis

The application separates successful authentication events from failed authentication events.

It also searches for temporary-lockout events and brute-force indicators.

The historical dashboard can display:

- total events;
- successful logins;
- failed logins;
- brute-force detections;
- temporary lockouts;
- attack user;
- source IP address; and
- most recent attack time.

---

# 10. Independent Detection Engine

A major component of this project is the independent detector.

The detector does not simply display Keycloak's security classification.

Instead, it independently evaluates authentication events generated during a controlled experiment.

It analyzes:

```text
LOGIN_ERROR events
```

and:

```text
USER_DISABLED_BY_TEMPORARY_LOCKOUT events
```

The detector groups failures by:

- source IP address; and
- target username.

The implementation therefore measures both repeated source activity and repeated targeting of a user account. :contentReference[oaicite:4]{index=4}

---

# 11. Failed Login Threshold

The current research threshold is:

```text
FAILED_LOGIN_THRESHOLD = 3
```

This means three or more relevant authentication failures can contribute to elevated attack classification.

The threshold is currently a research parameter and can be adjusted during future experiments.

---

# 12. Custom Risk-Scoring Model

The detector assigns a numerical security risk score.

## Failed Login Frequency

Each failed login contributes:

```text
+10 points
```

The failed-login contribution is capped at:

```text
40 points
```

Example:

```text
1 failed login  = 10 points
2 failed logins = 20 points
3 failed logins = 30 points
4+ failures     = maximum 40 points
```

## Repeated Source IP

If authentication failures from the same source IP reach the configured threshold:

```text
+20 points
```

## Repeated Target User

If authentication failures against the same user reach the threshold:

```text
+20 points
```

## Keycloak Temporary Lockout

If Keycloak records a temporary account lockout:

```text
+40 points
```

The risk score is capped at:

```text
100
```

These scoring components are implemented directly in the independent detection engine. :contentReference[oaicite:5]{index=5}

---

# 13. Risk Classification

The custom detector converts the numerical risk score into three risk levels.

| Risk Score | Classification |
|---|---|
| 0–29 | LOW |
| 30–59 | MEDIUM |
| 60–100 | HIGH |

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

The application also independently derives a Keycloak assessment and compares the two results as either `MATCH` or `MISMATCH`. :contentReference[oaicite:6]{index=6}

---

# 14. Controlled Experiment Framework

The application contains a controlled experiment framework for evaluating the detector.

Two experiment types are supported:

```text
ATTACK
```

and:

```text
NORMAL
```

The experiment type selected by the researcher becomes the experiment's:

```text
GROUND TRUTH
```

---

# 15. Experiment Isolation

A critical research-design feature is experiment isolation.

Authentication events from previous experiments should not influence the result of a new experiment.

To address this problem, the system uses two mechanisms.

## 15.1 Reset Keycloak Brute-Force State

Before starting a new experiment, the application clears Keycloak's existing brute-force state.

This is done before recording the experiment start timestamp. :contentReference[oaicite:7]{index=7}

## 15.2 Start/End Event Window

Each experiment records:

```text
Experiment Start Time
```

and:

```text
Experiment Finish Time
```

Only events occurring between these timestamps are passed to the detector.

Conceptually:

```text
Previous events
      X
      X
      X

------------------------------
EXPERIMENT START
------------------------------

Event 1
Event 2
Event 3
Event 4

------------------------------
EXPERIMENT FINISH
------------------------------

Future events
      X
      X
```

Only:

```text
Event 1
Event 2
Event 3
Event 4
```

are analyzed.

The implementation explicitly filters Keycloak events according to these experiment start and finish timestamps. :contentReference[oaicite:8]{index=8}

---

# 16. Controlled Experiment Procedure

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

When an experiment is finished, the application retrieves Keycloak events, restricts them to the isolated experiment window, runs the detector, generates a prediction, and stores the resulting experiment. :contentReference[oaicite:9]{index=9}

---

# 17. Attack Experiments

ATTACK experiments intentionally generate suspicious authentication behavior inside the controlled local laboratory.

Examples include:

- repeated incorrect passwords;
- repeated failures against one account;
- multiple failures from the same source IP;
- attempts that trigger Keycloak brute-force protection; and
- mixed authentication sequences.

The purpose is to determine whether the independent detector predicts:

```text
ATTACK
```

when the experiment ground truth is:

```text
ATTACK
```

---

# 18. Normal Experiments

NORMAL experiments contain legitimate authentication behavior without an intentional attack sequence.

The desired detector output is:

```text
NORMAL
```

when ground truth is:

```text
NORMAL
```

These experiments are important for measuring false positives.

---

# 19. Confusion Matrix

Each completed experiment is assigned one of four outcomes.

## True Positive

```text
Ground Truth = ATTACK
Prediction   = ATTACK
```

Result:

```text
TRUE POSITIVE
```

## True Negative

```text
Ground Truth = NORMAL
Prediction   = NORMAL
```

Result:

```text
TRUE NEGATIVE
```

## False Positive

```text
Ground Truth = NORMAL
Prediction   = ATTACK
```

Result:

```text
FALSE POSITIVE
```

## False Negative

```text
Ground Truth = ATTACK
Prediction   = NORMAL
```

Result:

```text
FALSE NEGATIVE
```

The application implements these confusion-matrix classifications automatically. :contentReference[oaicite:10]{index=10}

---

# 20. Current Experimental Results

The current controlled dataset contains:

```text
15 total experiments
```

consisting of:

```text
5 ATTACK experiments
10 NORMAL experiments
```

Current results:

| Metric | Result |
|---|---:|
| Total Experiments | 15 |
| True Positives | 5 |
| True Negatives | 10 |
| False Positives | 0 |
| False Negatives | 0 |
| Accuracy | 100.00% |
| Precision | 100.00% |
| Recall | 100.00% |
| F1 Score | 100.00% |
| False Positive Rate | 0.00% |
| False Negative Rate | 0.00% |

---

# 21. Current Confusion Matrix

| | Predicted ATTACK | Predicted NORMAL |
|---|---:|---:|
| Actual ATTACK | TP = 5 | FN = 0 |
| Actual NORMAL | FP = 0 | TN = 10 |

Graphically:

```text
                    PREDICTED

                 ATTACK     NORMAL

ACTUAL ATTACK       5          0

ACTUAL NORMAL       0         10
```

---

# 22. Interpretation of Current Results

For the current controlled experimental dataset:

```text
TP = 5
TN = 10
FP = 0
FN = 0
```

This produces:

```text
Accuracy  = 100%
Precision = 100%
Recall    = 100%
F1 Score  = 100%
```

These results should be interpreted carefully.

They demonstrate that the detector correctly classified the current controlled test cases.

They do **not** establish that the detector has 100% accuracy in unrestricted real-world or production environments.

The current experimental dataset remains relatively small, and additional testing is planned.

---

# 23. Planned 20-Experiment Baseline

The initial baseline target is:

```text
20 experiments
```

with:

```text
10 ATTACK experiments
10 NORMAL experiments
```

Current progress:

```text
ATTACK: 5 / 10
NORMAL: 10 / 10
TOTAL:  15 / 20
```

Remaining:

```text
5 ATTACK experiments
```

After these tests are complete, the README will be updated with the final 20-experiment results.

---

# 24. Performance Metrics

The application automatically calculates several standard classification metrics.

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
2 × (Precision × Recall)
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

The implementation calculates these values from the stored experiment history rather than manually entering the results. :contentReference[oaicite:11]{index=11}

---

# 25. Custom Detector vs Keycloak

The project also records both:

```text
Custom Detector Prediction
```

and:

```text
Keycloak Prediction
```

This allows comparison between the independent detector and the underlying identity provider.

The system calculates:

```text
Custom / Keycloak Agreement Rate
```

This enables future experiments investigating circumstances where:

```text
Custom Detector = ATTACK
Keycloak        = NORMAL
```

or:

```text
Custom Detector = NORMAL
Keycloak        = ATTACK
```

Such disagreements can be useful research observations.

---

# 26. Experiment Data Recorded

For each completed experiment, the system stores information including:

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
Detection Signals
```

---

# 27. Evaluation Dashboard

The Detector Evaluation Dashboard displays:

- total experiments;
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
- confusion matrix; and
- complete experiment history.

The current application generates these metrics dynamically from stored controlled experiments. :contentReference[oaicite:12]{index=12}

---

# 28. Application Routes

| Route | Function |
|---|---|
| `/` | Main authenticated dashboard |
| `/login` | Begin OAuth/OIDC authentication |
| `/callback` | OAuth/OIDC callback |
| `/security-dashboard` | Security monitoring and experiments |
| `/evaluation` | Detector evaluation |
| `/keycloak-events` | View Keycloak security events |
| `/security-events` | View application security events |
| `/logout` | Destroy application session |

---

# 29. Application Security Logging

The Node.js application also maintains its own security-event history.

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

This provides an application-level audit trail separate from Keycloak's event log.

---

# 30. Environment Variables

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

The repository should contain:

```text
.env.example
```

instead.

---

# 31. Installation

Clone the repository:

```bash
git clone https://github.com/omudepaul/web2-security-lab.git
```

Move into the project directory:

```bash
cd web2-security-lab
```

Install dependencies:

```bash
npm install
```

---

# 32. Running the Node.js Application

Start Keycloak first.

Then start the research application:

```bash
node index.js
```

Expected output includes:

```text
Research application running at http://localhost:3000
Keycloak security monitoring enabled
Independent detection engine enabled
Isolated experiment framework enabled
Failed-login threshold: 3
```

Open:

```text
http://localhost:3000
```

in a browser.

---

# 33. Development Environment

The project was developed and tested in a local research environment using:

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

# 34. GitHub Workflow

Typical development workflow:

```bash
git status
git add .
git commit -m "Describe research changes"
git push origin main
```

GitHub is used to maintain:

- source-code history;
- experiment-framework development;
- documentation;
- CI/CD configuration; and
- reproducibility of the project.

---

# 35. Security Considerations

This application is a research prototype.

Important considerations include:

- experiments should only target systems owned by or explicitly authorized for the researcher;
- real credentials should never be committed;
- `.env` should remain excluded from version control;
- monitoring-client secrets should remain private;
- Keycloak administrative permissions should follow least privilege;
- local JSON storage is not intended as a production database;
- HTTPS should be used in a production deployment;
- production session storage should replace default in-memory session storage.

---

# 36. Current Research Limitations

Several limitations remain.

## Small Dataset

The current evaluation contains only 15 completed experiments.

## Controlled Environment

Testing is performed in a controlled local laboratory.

## Source IP Diversity

Localhost testing results in limited source-IP diversity.

## Manually Defined Risk Weights

Risk-score weights are currently manually selected research parameters.

## Limited Attack Categories

The present experiments primarily investigate authentication failure and brute-force behavior.

## Local Persistence

Experiment records are currently stored using JSON rather than a research database.

---

# 37. Future Experimental Work

Future work can include:

- completing the 20-experiment baseline;
- increasing the experiment dataset;
- additional NORMAL trials;
- additional ATTACK trials;
- password-spraying scenarios;
- low-and-slow authentication attacks;
- distributed source-IP experiments;
- multiple-user targeting;
- varying authentication timing;
- threshold sensitivity analysis;
- detection latency measurements;
- false-positive analysis;
- false-negative analysis;
- ROC analysis;
- comparison with alternative detectors;
- adaptive risk thresholds;
- machine-learning-based detection;
- time-series attack detection; and
- cloud deployment.

---

# 38. Research Extension Toward Cloud Security

The current Web2 security laboratory provides a foundation for broader cloud-security research.

Potential future extensions include:

```text
Identity Security
       +
Authentication Monitoring
       +
Independent Detection
       +
Cloud Deployment
       +
Adaptive Defense
       +
Cross-Layer Security
```

The system may also provide a baseline for investigating security mechanisms beyond conventional Web2 authentication environments.

---

# 39. Reproducibility

A central objective of the project is reproducibility.

Controlled experiments use:

- explicit ground truth;
- automatic state reset;
- timestamp isolation;
- structured event retrieval;
- deterministic risk-scoring rules;
- automatic outcome classification; and
- persistent experiment histories.

This makes it possible to repeat experiments and compare changes to the detector over time.

---

# 40. Research Status

Current status:

```text
[COMPLETED] Keycloak source deployment
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
[COMPLETED] Confusion matrix
[COMPLETED] Performance metrics
[COMPLETED] Evaluation dashboard
[COMPLETED] GitHub repository
[IN PROGRESS] 20-experiment baseline
```

Current experimental progress:

```text
15 / 20 experiments completed
```

---

# 41. Repository Structure

```text
web2-security-lab/
|
|-- .github/
|   |
|   `-- workflows/
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


## Experimental Results

The security detector was evaluated using controlled authentication experiments involving normal login behavior, repeated failed logins, brute-force activity, and password-spraying scenarios.

A total of **22 controlled experiments** were recorded.

### Overall Performance

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

### Confusion Matrix

| Actual / Predicted | ATTACK | NORMAL |
|---|---:|---:|
| ATTACK | TP = 7 | FN = 1 |
| NORMAL | FP = 1 | TN = 13 |

### Key Experimental Findings

The experiments demonstrated several important characteristics of the detector.

#### Normal Authentication

Normal authentication activity was correctly classified as NORMAL.

The detector also tolerated occasional user mistakes:

- One incorrect password produced a risk score of 10 and remained NORMAL.
- Two incorrect passwords produced a risk score of 20 and remained NORMAL.

These tests resulted in True Negative classifications.

#### Repeated Authentication Attack

Three repeated failed login attempts against the same account from the same source were successfully detected as an attack.

The detector combined:

- failed-login frequency,
- repeated source IP activity,
- repeated targeting of the same account, and
- Keycloak temporary-lockout information.

A test involving three failed attempts followed by a Keycloak lockout reached a risk score of 100 and resulted in a True Positive.

#### Password-Spraying Experiment

A password-spraying style experiment was performed by attempting one incorrect password against multiple user accounts.

With three failed attempts distributed across different accounts, the detector produced:

- Risk Score: 50
- Classification: MEDIUM
- Prediction: ATTACK
- Outcome: TRUE POSITIVE
- Keycloak Lockout: No

This result is significant because the attack was detected even though no individual account accumulated enough failures to trigger a Keycloak temporary lockout.

#### False Negative Boundary

A controlled ATTACK experiment containing only two failed authentication attempts produced:

- Risk Score: 20
- Prediction: NORMAL
- Outcome: FALSE NEGATIVE

This identifies an important limitation of the current threshold-based detector. Low-volume attack activity may remain below the detection threshold.

#### False Positive Boundary

A controlled NORMAL boundary experiment containing three failed attempts resulted in a Keycloak lockout and was classified as ATTACK.

This produced a False Positive according to the experiment's assigned NORMAL ground truth.

The result demonstrates the trade-off between detecting repeated malicious authentication attempts and tolerating repeated legitimate user errors.

## Interpretation

The experimental results show that the detector can identify conventional brute-force activity and multi-account password-spraying behavior while tolerating one or two isolated authentication mistakes.

The observed false positive and false negative cases also identify useful areas for future improvement. A more advanced detector could incorporate temporal behavior, adaptive thresholds, account diversity, source-IP diversity, and historical authentication patterns instead of relying primarily on fixed thresholds.

These results provide a measurable Web2 security baseline for subsequent research into enhanced authentication-security mechanisms.



Runtime experiment files may also be generated locally.

---

# 42. Disclaimer

This project is intended solely for:

- cybersecurity research;
- controlled experimentation;
- education; and
- authorized security testing.

Attack experiments should only be conducted against systems, applications, accounts, and infrastructure that the researcher owns or has explicit authorization to test.

---

# 43. Author

**Paul Omude**

Ph.D. Student in Computer Science  
Oklahoma State University

Research focus:

- Cloud Security
- Web Security
- Authentication Security
- Identity and Access Management
- Security Monitoring
- Attack Detection

---

# 44. Project Status

**Active Research Project**

The next milestone is completion and analysis of the full **20 controlled experiments** followed by expanded detector testing.