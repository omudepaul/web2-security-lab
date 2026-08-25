require("dotenv").config();

const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const LOG_FILE = path.join(__dirname, "security-events.json");
const EXPERIMENT_FILE = path.join(__dirname, "detector-experiments.json");

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const MONITOR_CLIENT_ID = process.env.MONITOR_CLIENT_ID;
const MONITOR_CLIENT_SECRET = process.env.MONITOR_CLIENT_SECRET;

const FAILED_LOGIN_THRESHOLD = 3;

/*
|--------------------------------------------------------------------------
| EXPRESS CONFIGURATION
|--------------------------------------------------------------------------
*/

app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "research-app-secret",
    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

/*
|--------------------------------------------------------------------------
| JSON FILE HELPERS
|--------------------------------------------------------------------------
*/

function loadJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const data = fs.readFileSync(filePath, "utf8");

    if (!data.trim()) {
      return [];
    }

    return JSON.parse(data);
  } catch (error) {
    console.error(`Could not read ${filePath}:`, error);
    return [];
  }
}

function saveJsonFile(filePath, data) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

/*
|--------------------------------------------------------------------------
| LOCAL SECURITY EVENT STORAGE
|--------------------------------------------------------------------------
*/

let securityEvents = loadJsonFile(LOG_FILE);
let experiments = loadJsonFile(EXPERIMENT_FILE);

function saveSecurityEvents() {
  saveJsonFile(LOG_FILE, securityEvents);
}

function saveExperiments() {
  saveJsonFile(EXPERIMENT_FILE, experiments);
}

function addSecurityEvent(type, username, details) {
  securityEvents.unshift({
    time: new Date().toISOString(),
    type,
    username: username || "unknown",
    details: details || "",
  });

  if (securityEvents.length > 200) {
    securityEvents = securityEvents.slice(0, 200);
  }

  saveSecurityEvents();
}

/*
|--------------------------------------------------------------------------
| HELPER FUNCTIONS
|--------------------------------------------------------------------------
*/

function escapeHtml(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) {
    return "Not available";
  }

  return new Date(Number(value) * 1000).toLocaleString();
}

function formatKeycloakTime(value) {
  if (!value) {
    return "Not available";
  }

  return new Date(Number(value)).toLocaleString();
}

function formatIsoTime(value) {
  if (!value) {
    return "Not available";
  }

  return new Date(value).toLocaleString();
}

function percentage(numerator, denominator) {
  if (!denominator) {
    return 0;
  }

  return (numerator / denominator) * 100;
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}

/*
|--------------------------------------------------------------------------
| KEYCLOAK SERVICE ACCOUNT TOKEN
|--------------------------------------------------------------------------
*/

async function getMonitorAccessToken() {
  const tokenUrl =
    `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}` +
    `/protocol/openid-connect/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",

    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },

    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: MONITOR_CLIENT_ID,
      client_secret: MONITOR_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Could not obtain monitor token. HTTP ${response.status}: ${text}`
    );
  }

  const data = await response.json();

  return data.access_token;
}

/*
|--------------------------------------------------------------------------
| KEYCLOAK EVENTS
|--------------------------------------------------------------------------
*/

async function getKeycloakEvents() {
  const accessToken = await getMonitorAccessToken();

  const eventsUrl =
    `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}` +
    `/events?max=100`;

  const response = await fetch(eventsUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Could not retrieve Keycloak events. HTTP ${response.status}: ${text}`
    );
  }

  return response.json();
}

/*
|--------------------------------------------------------------------------
| EVENT HELPERS
|--------------------------------------------------------------------------
*/

function getEventUsername(event) {
  return (
    event.details?.username ||
    event.username ||
    event.userId ||
    "Not available"
  );
}

/*
|--------------------------------------------------------------------------
| FILTER EVENTS FOR ONE EXPERIMENT
|--------------------------------------------------------------------------
|
| This is the important correction.
|
| Only events generated BETWEEN experiment start and finish
| are analyzed.
|
*/

function filterExperimentEvents(events, startTime, endTime) {
  return events.filter((event) => {
    const eventTime = Number(event.time || 0);

    return (
      eventTime >= Number(startTime) &&
      eventTime <= Number(endTime)
    );
  });
}

/*
|--------------------------------------------------------------------------
| HISTORICAL KEYCLOAK ANALYSIS
|--------------------------------------------------------------------------
*/

function analyzeKeycloakEvents(events) {
  const successfulLoginEvents = events.filter(
    (event) => event.type === "LOGIN"
  );

  const failedLoginEvents = events.filter(
    (event) => event.type === "LOGIN_ERROR"
  );

  const lockoutEvents = events
    .filter(
      (event) =>
        event.type === "USER_DISABLED_BY_TEMPORARY_LOCKOUT"
    )
    .sort(
      (a, b) =>
        Number(b.time || 0) - Number(a.time || 0)
    );

  const reasonEvents = events.filter(
    (event) =>
      event.details?.reason === "brute_force_attack_detected"
  );

  const attackMap = new Map();

  for (const event of [...lockoutEvents, ...reasonEvents]) {
    const key = [
      event.time || "",
      event.type || "",
      event.userId || "",
      event.ipAddress || "",
    ].join("|");

    attackMap.set(key, event);
  }

  const bruteForceEvents = Array.from(
    attackMap.values()
  ).sort(
    (a, b) =>
      Number(b.time || 0) - Number(a.time || 0)
  );

  const latestAttackEvent = bruteForceEvents[0] || null;

  let attackUser = "Not available";

  if (latestAttackEvent) {
    const attackTimestamp = Number(latestAttackEvent.time || 0);

    const relatedLoginError = failedLoginEvents
      .filter((event) => {
        const eventTime = Number(event.time || 0);

        return (
          eventTime <= attackTimestamp &&
          attackTimestamp - eventTime <= 60000
        );
      })
      .sort(
        (a, b) =>
          Number(b.time || 0) - Number(a.time || 0)
      )[0];

    attackUser =
      latestAttackEvent.details?.username ||
      relatedLoginError?.details?.username ||
      latestAttackEvent.userId ||
      "Not available";
  }

  return {
    totalEvents: events.length,

    successfulLogins: successfulLoginEvents.length,

    failedLogins: failedLoginEvents.length,

    bruteForceDetections: bruteForceEvents.length,

    temporaryLockouts: lockoutEvents.length,

    attackUser,

    attackIp:
      latestAttackEvent?.ipAddress ||
      "Not available",

    lastAttackTime:
      latestAttackEvent
        ? formatKeycloakTime(latestAttackEvent.time)
        : "Not available",
  };
}

/*
|--------------------------------------------------------------------------
| INDEPENDENT DETECTION ENGINE
|--------------------------------------------------------------------------
|
| This detector can now analyze ANY supplied set of events.
|
| During an experiment we pass ONLY events that occurred during
| that experiment.
|
*/

function runIndependentDetector(events) {
  const failedEvents = events.filter(
    (event) => event.type === "LOGIN_ERROR"
  );

  const lockoutEvents = events.filter(
    (event) =>
      event.type === "USER_DISABLED_BY_TEMPORARY_LOCKOUT"
  );

  const failuresByIp = {};
  const failuresByUser = {};

  for (const event of failedEvents) {
    const ip = event.ipAddress || "unknown";

    failuresByIp[ip] = (failuresByIp[ip] || 0) + 1;

    const username =
      event.details?.username ||
      "unknown";

    failuresByUser[username] =
      (failuresByUser[username] || 0) + 1;
  }

  let highestFailureIp = "Not available";
  let highestIpFailureCount = 0;

  for (const [ip, count] of Object.entries(failuresByIp)) {
    if (count > highestIpFailureCount) {
      highestFailureIp = ip;
      highestIpFailureCount = count;
    }
  }

  let highestFailureUser = "Not available";
  let highestUserFailureCount = 0;

  for (const [username, count] of Object.entries(failuresByUser)) {
    if (count > highestUserFailureCount) {
      highestFailureUser = username;
      highestUserFailureCount = count;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | CUSTOM RISK SCORE
  |--------------------------------------------------------------------------
  */

  let riskScore = 0;
  const signals = [];

  /*
    Failed-login frequency.

    +10 per failure.
    Maximum = +40.
  */

  if (failedEvents.length > 0) {
    const failureScore = Math.min(
      failedEvents.length * 10,
      40
    );

    riskScore += failureScore;

    signals.push(
      `${failedEvents.length} failed login attempt(s) detected during experiment`
    );
  }

  /*
    Repeated source IP.
  */

  if (
    highestIpFailureCount >= FAILED_LOGIN_THRESHOLD
  ) {
    riskScore += 20;

    signals.push(
      `Repeated failures from IP ${highestFailureIp} (${highestIpFailureCount} attempts)`
    );
  }

  /*
    Repeated target account.
  */

  if (
    highestUserFailureCount >= FAILED_LOGIN_THRESHOLD
  ) {
    riskScore += 20;

    signals.push(
      `Repeated failures against user ${highestFailureUser} (${highestUserFailureCount} attempts)`
    );
  }

  /*
    Keycloak lockout confirmation.
  */

  if (lockoutEvents.length > 0) {
    riskScore += 40;

    signals.push(
      `Keycloak temporary lockout detected (${lockoutEvents.length} event(s))`
    );
  }

  riskScore = Math.min(riskScore, 100);

  /*
  |--------------------------------------------------------------------------
  | CUSTOM CLASSIFICATION
  |--------------------------------------------------------------------------
  */

  let classification = "LOW";

  if (riskScore >= 30 && riskScore < 60) {
    classification = "MEDIUM";
  }

  if (riskScore >= 60) {
    classification = "HIGH";
  }

  /*
  |--------------------------------------------------------------------------
  | KEYCLOAK ASSESSMENT
  |--------------------------------------------------------------------------
  */

  let keycloakAssessment = "LOW";

  if (
    failedEvents.length >= FAILED_LOGIN_THRESHOLD
  ) {
    keycloakAssessment = "MEDIUM";
  }

  if (lockoutEvents.length > 0) {
    keycloakAssessment = "HIGH";
  }

  const comparison =
    classification === keycloakAssessment
      ? "MATCH"
      : "MISMATCH";

  /*
    For binary evaluation:

    LOW = NORMAL
    MEDIUM/HIGH = ATTACK
  */

  const customPrediction =
    classification === "LOW"
      ? "NORMAL"
      : "ATTACK";

  const keycloakPrediction =
    keycloakAssessment === "LOW"
      ? "NORMAL"
      : "ATTACK";

  return {
    totalExperimentEvents: events.length,

    failedLoginCount: failedEvents.length,

    lockoutCount: lockoutEvents.length,

    highestFailureIp,

    highestIpFailureCount,

    highestFailureUser,

    highestUserFailureCount,

    riskScore,

    classification,

    keycloakAssessment,

    comparison,

    customPrediction,

    keycloakPrediction,

    signals,
  };
}

/*
|--------------------------------------------------------------------------
| CONFUSION-MATRIX OUTCOME
|--------------------------------------------------------------------------
*/

function classifyExperimentOutcome(
  groundTruth,
  prediction
) {
  if (
    groundTruth === "ATTACK" &&
    prediction === "ATTACK"
  ) {
    return "TRUE POSITIVE";
  }

  if (
    groundTruth === "NORMAL" &&
    prediction === "NORMAL"
  ) {
    return "TRUE NEGATIVE";
  }

  if (
    groundTruth === "NORMAL" &&
    prediction === "ATTACK"
  ) {
    return "FALSE POSITIVE";
  }

  return "FALSE NEGATIVE";
}

/*
|--------------------------------------------------------------------------
| PERFORMANCE METRICS
|--------------------------------------------------------------------------
*/

function calculateEvaluationMetrics() {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  let keycloakMatches = 0;

  for (const experiment of experiments) {
    if (experiment.outcome === "TRUE POSITIVE") {
      truePositive++;
    }

    if (experiment.outcome === "TRUE NEGATIVE") {
      trueNegative++;
    }

    if (experiment.outcome === "FALSE POSITIVE") {
      falsePositive++;
    }

    if (experiment.outcome === "FALSE NEGATIVE") {
      falseNegative++;
    }

    if (
      experiment.customPrediction ===
      experiment.keycloakPrediction
    ) {
      keycloakMatches++;
    }
  }

  const total = experiments.length;

  const accuracy = percentage(
    truePositive + trueNegative,
    total
  );

  const precision = percentage(
    truePositive,
    truePositive + falsePositive
  );

  const recall = percentage(
    truePositive,
    truePositive + falseNegative
  );

  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) /
        (precision + recall);

  const agreementRate = percentage(
    keycloakMatches,
    total
  );

  const falsePositiveRate = percentage(
    falsePositive,
    falsePositive + trueNegative
  );

  const falseNegativeRate = percentage(
    falseNegative,
    falseNegative + truePositive
  );

  return {
    total,

    truePositive,
    trueNegative,
    falsePositive,
    falseNegative,

    accuracy,
    precision,
    recall,
    f1,

    agreementRate,

    falsePositiveRate,
    falseNegativeRate,
  };
}

/*
|--------------------------------------------------------------------------
| DASHBOARD STYLES
|--------------------------------------------------------------------------
*/

function dashboardStyles() {
  return `
    <style>

      * {
        box-sizing: border-box;
      }

      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 30px;
        background: #f5f7fa;
        color: #222;
      }

      h1 {
        margin-top: 0;
      }

      .cards {
        display: flex;
        flex-wrap: wrap;
        gap: 18px;
        margin: 20px 0 35px 0;
      }

      .card {
        background: white;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 22px;
        min-width: 210px;

        box-shadow:
          0 2px 5px
          rgba(0,0,0,0.08);
      }

      .number {
        font-size: 34px;
        font-weight: bold;
      }

      .engine-box {
        background: white;

        border:
          2px solid #345995;

        border-radius: 8px;

        padding: 25px;
        margin: 25px 0;
      }

      .experiment-box {
        background: white;

        border:
          2px solid #5c6bc0;

        border-radius: 8px;

        padding: 25px;
        margin: 25px 0;
      }

      .active-experiment {
        background: #fff8e1;

        border:
          2px solid #f9a825;

        border-radius: 8px;

        padding: 25px;
        margin: 25px 0;
      }

      .success-box {
        background: #e8f5e9;

        border:
          2px solid #2e7d32;

        border-radius: 8px;

        padding: 20px;
        margin: 20px 0;
      }

      .risk-high {
        color: #b00020;
        font-weight: bold;
      }

      .risk-medium {
        color: #a65f00;
        font-weight: bold;
      }

      .risk-low {
        color: #1b5e20;
        font-weight: bold;
      }

      .true-result {
        color: #1b5e20;
        font-weight: bold;
      }

      .false-result {
        color: #b00020;
        font-weight: bold;
      }

      .score {
        font-size: 42px;
        font-weight: bold;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background: white;
        margin-top: 15px;
      }

      th,
      td {
        border: 1px solid #ccc;
        padding: 12px;
        text-align: left;
        vertical-align: top;
      }

      th {
        background: #eee;
      }

      button {
        padding: 12px 20px;
        margin-right: 10px;
        margin-top: 8px;
        cursor: pointer;
        font-size: 15px;
      }

      .attack-button {
        background: #b00020;
        color: white;
        border: none;
      }

      .normal-button {
        background: #1b5e20;
        color: white;
        border: none;
      }

      .finish-button {
        background: #1565c0;
        color: white;
        border: none;
      }

      .cancel-button {
        background: #666;
        color: white;
        border: none;
      }

      .clear-button {
        background: #444;
        color: white;
        border: none;
      }

      .links {
        margin-top: 30px;
      }

      .links a {
        margin-right: 25px;
      }

    </style>
  `;
}

/*
|--------------------------------------------------------------------------
| APPLICATION
|--------------------------------------------------------------------------
*/

async function start() {
  const client = await import("openid-client");

  const issuer = new URL(
    `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`
  );

  const config = await client.discovery(
    issuer,
    "research-app",
    undefined,
    client.None(),
    {
      execute: [
        client.allowInsecureRequests,
      ],
    }
  );

  /*
  |--------------------------------------------------------------------------
  | HOME
  |--------------------------------------------------------------------------
  */

  app.get("/", (req, res) => {
    if (!req.session.user) {
      return res.send(`
        ${dashboardStyles()}

        <h1>
          Web2 Security Research Application
        </h1>

        <p>
          <strong>
            Authentication Status:
          </strong>

          Not authenticated
        </p>

        <p>
          <a href="/login">
            Login with Keycloak
          </a>
        </p>
      `);
    }

    const user = req.session.user;

    res.send(`
      ${dashboardStyles()}

      <h1>
        Web2 Security Research Application
      </h1>

      <h2>
        Protected OAuth 2.0 / OIDC Dashboard
      </h2>

      <p>
        <strong>
          Authentication Status:
        </strong>

        Authenticated
      </p>

      <p>
        <strong>
          Username:
        </strong>

        ${escapeHtml(
          user.preferred_username
        )}
      </p>

      <p>
        <strong>
          Email:
        </strong>

        ${escapeHtml(
          user.email
        )}
      </p>

      <p>
        <strong>
          User ID:
        </strong>

        ${escapeHtml(
          user.sub
        )}
      </p>

      <p>
        <strong>
          Token Issued:
        </strong>

        ${formatTime(user.iat)}
      </p>

      <p>
        <strong>
          Token Expires:
        </strong>

        ${formatTime(user.exp)}
      </p>

      <hr>

      <h3>
        Research Dashboards
      </h3>

      <p>
        <a href="/security-dashboard">
          Security Detection Dashboard
        </a>
      </p>

      <p>
        <a href="/evaluation">
          Detector Evaluation Dashboard
        </a>
      </p>

      <p>
        <a href="/keycloak-events">
          Raw Keycloak Events
        </a>
      </p>

      <p>
        <a href="/security-events">
          Application Security Events
        </a>
      </p>

      <p>
        <a href="/logout">
          Logout
        </a>
      </p>
    `);
  });

  /*
  |--------------------------------------------------------------------------
  | LOGIN
  |--------------------------------------------------------------------------
  */

  app.get("/login", async (req, res) => {
    const codeVerifier =
      client.randomPKCECodeVerifier();

    const codeChallenge =
      await client.calculatePKCECodeChallenge(
        codeVerifier
      );

    req.session.codeVerifier =
      codeVerifier;

    const authorizationUrl =
      client.buildAuthorizationUrl(
        config,
        {
          redirect_uri:
            "http://localhost:3000/callback",

          scope:
            "openid profile email",

          code_challenge:
            codeChallenge,

          code_challenge_method:
            "S256",
        }
      );

    res.redirect(
      authorizationUrl.href
    );
  });

  /*
  |--------------------------------------------------------------------------
  | CALLBACK
  |--------------------------------------------------------------------------
  */

  app.get("/callback", async (req, res) => {
    try {
      const currentUrl =
        new URL(
          req.protocol +
            "://" +
            req.get("host") +
            req.originalUrl
        );

      const tokens =
        await client.authorizationCodeGrant(
          config,
          currentUrl,
          {
            pkceCodeVerifier:
              req.session.codeVerifier,

            idTokenExpected: true,
          }
        );

      const claims =
        tokens.claims();

      req.session.user =
        claims;

      addSecurityEvent(
        "LOGIN_SUCCESS",

        claims.preferred_username,

        "OAuth/OIDC authentication completed successfully"
      );

      res.redirect("/");
    } catch (error) {
      console.error(error);

      res
        .status(500)
        .send(
          "Authentication failed."
        );
    }
  });

  /*
  |--------------------------------------------------------------------------
  | SECURITY DASHBOARD
  |--------------------------------------------------------------------------
  */

  app.get(
    "/security-dashboard",
    async (req, res) => {
      if (!req.session.user) {
        return res
          .status(401)
          .send(
            "Authentication required."
          );
      }

      try {
        const events =
          await getKeycloakEvents();

        const historical =
          analyzeKeycloakEvents(
            events
          );

        /*
          Current detector status is informational only.
          Experimental metrics use isolated experiment events.
        */

        let experimentSection;

        if (
          req.session
            .activeExperiment
        ) {
          const active =
            req.session
              .activeExperiment;

          experimentSection = `
            <div class="active-experiment">

              <h2>
                Experiment In Progress
              </h2>

              <p>
                <strong>
                  Ground Truth:
                </strong>

                ${escapeHtml(
                  active.groundTruth
                )}
              </p>

              <p>
                <strong>
                  Started:
                </strong>

                ${formatIsoTime(
                  active.startedAtIso
                )}
              </p>

              <p>
                Perform the authentication
                activity for this test now.
              </p>

              ${
                active.groundTruth ===
                "ATTACK"
                  ? `
                    <p>
                      For the controlled
                      ATTACK test, perform the
                      failed-login sequence.
                    </p>
                  `
                  : `
                    <p>
                      For the controlled
                      NORMAL test, perform
                      normal authentication
                      activity only.
                    </p>
                  `
              }

              <form
                method="POST"
                action="/finish-experiment"
              >
                <button
                  class="finish-button"
                  type="submit"
                >
                  Finish & Analyze Experiment
                </button>
              </form>

              <form
                method="POST"
                action="/cancel-experiment"
              >
                <button
                  class="cancel-button"
                  type="submit"
                >
                  Cancel Experiment
                </button>
              </form>

            </div>
          `;
        } else {
          experimentSection = `
            <div class="experiment-box">

              <h2>
                Controlled Experiment
              </h2>

              <p>
                Start a new isolated experiment.
                Only Keycloak events generated
                after you press Start will be
                analyzed.
              </p>

              <form
                method="POST"
                action="/start-experiment"
              >

                <button
                  class="attack-button"
                  type="submit"
                  name="groundTruth"
                  value="ATTACK"
                >
                  Start ATTACK Test
                </button>

                <button
                  class="normal-button"
                  type="submit"
                  name="groundTruth"
                  value="NORMAL"
                >
                  Start NORMAL Test
                </button>

              </form>

            </div>
          `;
        }

        res.send(`
          ${dashboardStyles()}

          <h1>
            Security Detection Dashboard
          </h1>

          ${experimentSection}

          <h2>
            Historical Security Statistics
          </h2>

          <p>
            These statistics summarize
            stored Keycloak events and are
            separate from isolated experiment
            evaluation.
          </p>

          <div class="cards">

            <div class="card">
              <h3>Total Events</h3>

              <div class="number">
                ${historical.totalEvents}
              </div>
            </div>

            <div class="card">
              <h3>
                Successful Logins
              </h3>

              <div class="number">
                ${historical.successfulLogins}
              </div>
            </div>

            <div class="card">
              <h3>
                Failed Logins
              </h3>

              <div class="number">
                ${historical.failedLogins}
              </div>
            </div>

            <div class="card">
              <h3>
                Brute Force Detections
              </h3>

              <div class="number">
                ${historical.bruteForceDetections}
              </div>
            </div>

            <div class="card">
              <h3>
                Temporary Lockouts
              </h3>

              <div class="number">
                ${historical.temporaryLockouts}
              </div>
            </div>

          </div>

          <div class="links">

            <a href="/evaluation">
              Evaluation Dashboard
            </a>

            <a href="/keycloak-events">
              Raw Keycloak Events
            </a>

            <a href="/">
              Main Dashboard
            </a>

          </div>
        `);
      } catch (error) {
        console.error(error);

        res
          .status(500)
          .send(
            escapeHtml(
              error.message
            )
          );
      }
    }
  );

  /*
  |--------------------------------------------------------------------------
  | START ISOLATED EXPERIMENT
  |--------------------------------------------------------------------------
  */

  app.post(
    "/start-experiment",
    (req, res) => {
      if (!req.session.user) {
        return res
          .status(401)
          .send(
            "Authentication required."
          );
      }

      const groundTruth =
        req.body.groundTruth;

      if (
        groundTruth !== "ATTACK" &&
        groundTruth !== "NORMAL"
      ) {
        return res
          .status(400)
          .send(
            "Invalid experiment type."
          );
      }

      /*
        Record the exact experiment
        starting timestamp.

        Keycloak timestamps use
        milliseconds since epoch.
      */

      const startTimestamp =
        Date.now();

      req.session.activeExperiment = {
        groundTruth,

        startTimestamp,

        startedAtIso:
          new Date(
            startTimestamp
          ).toISOString(),
      };

      addSecurityEvent(
        "EXPERIMENT_STARTED",

        req.session.user
          .preferred_username,

        `Ground truth=${groundTruth}`
      );

      res.redirect(
        "/security-dashboard"
      );
    }
  );

  /*
  |--------------------------------------------------------------------------
  | FINISH AND ANALYZE EXPERIMENT
  |--------------------------------------------------------------------------
  */

  app.post(
    "/finish-experiment",
    async (req, res) => {
      if (!req.session.user) {
        return res
          .status(401)
          .send(
            "Authentication required."
          );
      }

      const active =
        req.session
          .activeExperiment;

      if (!active) {
        return res
          .status(400)
          .send(
            "No experiment is currently active."
          );
      }

      try {
        /*
          Capture finish time BEFORE
          requesting Keycloak events.
        */

        const endTimestamp =
          Date.now();

        const allEvents =
          await getKeycloakEvents();

        /*
          THE IMPORTANT FIX:

          Only analyze events produced
          inside this experiment.
        */

        const experimentEvents =
          filterExperimentEvents(
            allEvents,
            active.startTimestamp,
            endTimestamp
          );

        const detector =
          runIndependentDetector(
            experimentEvents
          );

        const outcome =
          classifyExperimentOutcome(
            active.groundTruth,
            detector.customPrediction
          );

        const durationMilliseconds =
          endTimestamp -
          active.startTimestamp;

        const experiment = {
          id: Date.now(),

          startedAt:
            active.startedAtIso,

          finishedAt:
            new Date(
              endTimestamp
            ).toISOString(),

          durationSeconds:
            Number(
              (
                durationMilliseconds /
                1000
              ).toFixed(2)
            ),

          recordedBy:
            req.session.user
              .preferred_username ||
            "unknown",

          groundTruth:
            active.groundTruth,

          customPrediction:
            detector.customPrediction,

          customClassification:
            detector.classification,

          riskScore:
            detector.riskScore,

          keycloakAssessment:
            detector.keycloakAssessment,

          keycloakPrediction:
            detector.keycloakPrediction,

          comparison:
            detector.comparison,

          outcome,

          experimentEvents:
            detector.totalExperimentEvents,

          failedLogins:
            detector.failedLoginCount,

          lockouts:
            detector.lockoutCount,

          sourceIp:
            detector.highestFailureIp,

          targetUser:
            detector.highestFailureUser,

          signals:
            detector.signals,
        };

        experiments.unshift(
          experiment
        );

        saveExperiments();

        addSecurityEvent(
          "EXPERIMENT_FINISHED",

          req.session.user
            .preferred_username,

          `Ground truth=${active.groundTruth}; prediction=${detector.customPrediction}; outcome=${outcome}`
        );

        /*
          Clear active experiment only
          after successful recording.
        */

        delete req.session
          .activeExperiment;

        res.redirect(
          "/evaluation"
        );
      } catch (error) {
        console.error(error);

        res
          .status(500)
          .send(
            escapeHtml(
              error.message
            )
          );
      }
    }
  );

  /*
  |--------------------------------------------------------------------------
  | CANCEL EXPERIMENT
  |--------------------------------------------------------------------------
  */

  app.post(
    "/cancel-experiment",
    (req, res) => {
      if (!req.session.user) {
        return res
          .status(401)
          .send(
            "Authentication required."
          );
      }

      if (
        req.session
          .activeExperiment
      ) {
        addSecurityEvent(
          "EXPERIMENT_CANCELLED",

          req.session.user
            .preferred_username,

          `Ground truth=${req.session.activeExperiment.groundTruth}`
        );
      }

      delete req.session
        .activeExperiment;

      res.redirect(
        "/security-dashboard"
      );
    }
  );

  /*
  |--------------------------------------------------------------------------
  | EVALUATION DASHBOARD
  |--------------------------------------------------------------------------
  */

  app.get(
    "/evaluation",
    (req, res) => {
      if (!req.session.user) {
        return res
          .status(401)
          .send(
            "Authentication required."
          );
      }

      const metrics =
        calculateEvaluationMetrics();

      const rows =
        experiments
          .map(
            (experiment) => {
              const outcomeClass =
                experiment.outcome.startsWith(
                  "TRUE"
                )
                  ? "true-result"
                  : "false-result";

              return `
                <tr>

                  <td>
                    ${escapeHtml(
                      formatIsoTime(
                        experiment.startedAt
                      )
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      formatIsoTime(
                        experiment.finishedAt
                      )
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      experiment.groundTruth
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      experiment.customPrediction
                    )}
                  </td>

                  <td>
                    ${experiment.riskScore}
                  </td>

                  <td>
                    ${escapeHtml(
                      experiment.keycloakPrediction
                    )}
                  </td>

                  <td>
                    ${
                      experiment.experimentEvents ??
                      "N/A"
                    }
                  </td>

                  <td>
                    ${
                      experiment.failedLogins ??
                      experiment.recentFailures ??
                      "N/A"
                    }
                  </td>

                  <td>
                    ${
                      experiment.lockouts ??
                      experiment.recentLockouts ??
                      "N/A"
                    }
                  </td>

                  <td>
                    ${escapeHtml(
                      experiment.sourceIp
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      experiment.targetUser
                    )}
                  </td>

                  <td class="${outcomeClass}">
                    ${escapeHtml(
                      experiment.outcome
                    )}
                  </td>

                </tr>
              `;
            }
          )
          .join("");

      res.send(`
        ${dashboardStyles()}

        <h1>
          Detector Evaluation Dashboard
        </h1>

        <p>
          Metrics are calculated from
          controlled experiments.
        </p>

        <p>
          New experiments use isolated
          start/end event windows to prevent
          contamination from previous tests.
        </p>

        <div class="cards">

          <div class="card">
            <h3>
              Recorded Experiments
            </h3>

            <div class="number">
              ${metrics.total}
            </div>
          </div>

          <div class="card">
            <h3>
              True Positives
            </h3>

            <div class="number">
              ${metrics.truePositive}
            </div>
          </div>

          <div class="card">
            <h3>
              True Negatives
            </h3>

            <div class="number">
              ${metrics.trueNegative}
            </div>
          </div>

          <div class="card">
            <h3>
              False Positives
            </h3>

            <div class="number">
              ${metrics.falsePositive}
            </div>
          </div>

          <div class="card">
            <h3>
              False Negatives
            </h3>

            <div class="number">
              ${metrics.falseNegative}
            </div>
          </div>

        </div>

        <h2>
          Performance Metrics
        </h2>

        <table>

          <tr>
            <th>
              Metric
            </th>

            <th>
              Value
            </th>
          </tr>

          <tr>
            <td>
              Accuracy
            </td>

            <td>
              ${formatPercent(
                metrics.accuracy
              )}
            </td>
          </tr>

          <tr>
            <td>
              Precision
            </td>

            <td>
              ${formatPercent(
                metrics.precision
              )}
            </td>
          </tr>

          <tr>
            <td>
              Recall
            </td>

            <td>
              ${formatPercent(
                metrics.recall
              )}
            </td>
          </tr>

          <tr>
            <td>
              F1 Score
            </td>

            <td>
              ${formatPercent(
                metrics.f1
              )}
            </td>
          </tr>

          <tr>
            <td>
              False Positive Rate
            </td>

            <td>
              ${formatPercent(
                metrics.falsePositiveRate
              )}
            </td>
          </tr>

          <tr>
            <td>
              False Negative Rate
            </td>

            <td>
              ${formatPercent(
                metrics.falseNegativeRate
              )}
            </td>
          </tr>

          <tr>
            <td>
              Custom / Keycloak Agreement
            </td>

            <td>
              ${formatPercent(
                metrics.agreementRate
              )}
            </td>
          </tr>

        </table>

        <h2>
          Confusion Matrix
        </h2>

        <table>

          <tr>
            <th></th>

            <th>
              Predicted ATTACK
            </th>

            <th>
              Predicted NORMAL
            </th>
          </tr>

          <tr>
            <th>
              Actual ATTACK
            </th>

            <td>
              TP =
              ${metrics.truePositive}
            </td>

            <td>
              FN =
              ${metrics.falseNegative}
            </td>
          </tr>

          <tr>
            <th>
              Actual NORMAL
            </th>

            <td>
              FP =
              ${metrics.falsePositive}
            </td>

            <td>
              TN =
              ${metrics.trueNegative}
            </td>
          </tr>

        </table>

        <h2>
          Experiment History
        </h2>

        <table>

          <tr>
            <th>Start</th>
            <th>Finish</th>
            <th>Ground Truth</th>
            <th>Custom Prediction</th>
            <th>Risk Score</th>
            <th>Keycloak Prediction</th>
            <th>Events</th>
            <th>Failures</th>
            <th>Lockouts</th>
            <th>Source IP</th>
            <th>Target User</th>
            <th>Outcome</th>
          </tr>

          ${
            rows ||
            `
              <tr>
                <td colspan="12">
                  No experiments recorded.
                </td>
              </tr>
            `
          }

        </table>

        <form
          method="POST"
          action="/clear-experiments"
        >

          <button
            class="clear-button"
            type="submit"
          >
            Clear Experiment History
          </button>

        </form>

        <div class="links">

          <a href="/security-dashboard">
            Security Dashboard
          </a>

          <a href="/">
            Main Dashboard
          </a>

        </div>
      `);
    }
  );

  /*
  |--------------------------------------------------------------------------
  | CLEAR EXPERIMENT HISTORY
  |--------------------------------------------------------------------------
  */

  app.post(
    "/clear-experiments",
    (req, res) => {
      if (!req.session.user) {
        return res
          .status(401)
          .send(
            "Authentication required."
          );
      }

      experiments = [];

      saveExperiments();

      addSecurityEvent(
        "EXPERIMENT_HISTORY_CLEARED",

        req.session.user
          .preferred_username,

        "Detector experiment history cleared"
      );

      res.redirect(
        "/evaluation"
      );
    }
  );

  /*
  |--------------------------------------------------------------------------
  | RAW KEYCLOAK EVENTS
  |--------------------------------------------------------------------------
  */

  app.get(
    "/keycloak-events",
    async (req, res) => {
      if (!req.session.user) {
        return res
          .status(401)
          .send(
            "Authentication required."
          );
      }

      try {
        const events =
          await getKeycloakEvents();

        events.sort(
          (a, b) =>
            Number(b.time || 0) -
            Number(a.time || 0)
        );

        const rows = events
          .map(
            (event) => `
              <tr>

                <td>
                  ${formatKeycloakTime(
                    event.time
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    event.type
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    getEventUsername(
                      event
                    )
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    event.ipAddress ||
                    ""
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    event.clientId ||
                    ""
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    event.error ||
                    event.details?.error ||
                    ""
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    event.details?.reason ||
                    ""
                  )}
                </td>

              </tr>
            `
          )
          .join("");

        res.send(`
          ${dashboardStyles()}

          <h1>
            Keycloak Security Event Monitor
          </h1>

          <table>

            <tr>
              <th>Time</th>
              <th>Event Type</th>
              <th>User</th>
              <th>IP Address</th>
              <th>Client</th>
              <th>Error</th>
              <th>Reason</th>
            </tr>

            ${rows}

          </table>

          <div class="links">

            <a href="/security-dashboard">
              Security Dashboard
            </a>

            <a href="/">
              Main Dashboard
            </a>

          </div>
        `);
      } catch (error) {
        console.error(error);

        res
          .status(500)
          .send(
            escapeHtml(
              error.message
            )
          );
      }
    }
  );

  /*
  |--------------------------------------------------------------------------
  | APPLICATION SECURITY EVENTS
  |--------------------------------------------------------------------------
  */

  app.get(
    "/security-events",
    (req, res) => {
      if (!req.session.user) {
        return res
          .status(401)
          .send(
            "Authentication required."
          );
      }

      const rows =
        securityEvents
          .map(
            (event) => `
              <tr>

                <td>
                  ${escapeHtml(
                    event.time
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    event.type
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    event.username
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    event.details
                  )}
                </td>

              </tr>
            `
          )
          .join("");

      res.send(`
        ${dashboardStyles()}

        <h1>
          Application Security Monitor
        </h1>

        <table>

          <tr>
            <th>Time</th>
            <th>Event Type</th>
            <th>Username</th>
            <th>Details</th>
          </tr>

          ${rows}

        </table>

        <div class="links">

          <a href="/security-dashboard">
            Security Dashboard
          </a>

          <a href="/">
            Main Dashboard
          </a>

        </div>
      `);
    }
  );

  /*
  |--------------------------------------------------------------------------
  | LOGOUT
  |--------------------------------------------------------------------------
  */

  app.get(
    "/logout",
    (req, res) => {
      const username =
        req.session.user
          ?.preferred_username ||
        "unknown";

      addSecurityEvent(
        "LOGOUT",

        username,

        "Application session terminated"
      );

      req.session.destroy(
        () => {
          res.redirect("/");
        }
      );
    }
  );

  /*
  |--------------------------------------------------------------------------
  | START SERVER
  |--------------------------------------------------------------------------
  */

  app.listen(
    PORT,
    () => {
      console.log(
        `Research application running at http://localhost:${PORT}`
      );

      console.log(
        "Keycloak security monitoring enabled"
      );

      console.log(
        "Independent detection engine enabled"
      );

      console.log(
        "Isolated experiment framework enabled"
      );

      console.log(
        `Failed-login threshold: ${FAILED_LOGIN_THRESHOLD}`
      );

      console.log(
        `Security events: ${LOG_FILE}`
      );

      console.log(
        `Experiments: ${EXPERIMENT_FILE}`
      );
    }
  );
}

start().catch(
  (error) => {
    console.error(
      "Application startup failed:",
      error
    );
  }
);