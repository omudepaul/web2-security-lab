require("dotenv").config();

const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const LOG_FILE = path.join(__dirname, "security-events.json");

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const MONITOR_CLIENT_ID = process.env.MONITOR_CLIENT_ID;
const MONITOR_CLIENT_SECRET = process.env.MONITOR_CLIENT_SECRET;

/*
|--------------------------------------------------------------------------
| DETECTION ENGINE CONFIGURATION
|--------------------------------------------------------------------------
|
| These values control your independent security detector.
|
| RECENT_WINDOW_MINUTES:
|   Authentication activity inside this period is considered "recent".
|
| FAILED_LOGIN_THRESHOLD:
|   Number of failures required to trigger repeated-failure detection.
|
*/

const RECENT_WINDOW_MINUTES = 10;
const FAILED_LOGIN_THRESHOLD = 3;

/*
|--------------------------------------------------------------------------
| EXPRESS SESSION
|--------------------------------------------------------------------------
*/

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "research-app-secret",

    resave: false,
    saveUninitialized: false,
  })
);

/*
|--------------------------------------------------------------------------
| LOCAL APPLICATION SECURITY EVENTS
|--------------------------------------------------------------------------
*/

function loadSecurityEvents() {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return [];
    }

    const data =
      fs.readFileSync(
        LOG_FILE,
        "utf8"
      );

    if (!data.trim()) {
      return [];
    }

    return JSON.parse(data);
  } catch (error) {
    console.error(
      "Could not read security events:",
      error
    );

    return [];
  }
}

let securityEvents =
  loadSecurityEvents();

function saveSecurityEvents() {
  fs.writeFileSync(
    LOG_FILE,
    JSON.stringify(
      securityEvents,
      null,
      2
    ),
    "utf8"
  );
}

function addSecurityEvent(
  type,
  username,
  details
) {
  securityEvents.unshift({
    time:
      new Date().toLocaleString(),

    type,

    username:
      username || "unknown",

    details:
      details || "",
  });

  if (
    securityEvents.length > 100
  ) {
    securityEvents =
      securityEvents.slice(0, 100);
  }

  saveSecurityEvents();
}

/*
|--------------------------------------------------------------------------
| GENERAL HELPER FUNCTIONS
|--------------------------------------------------------------------------
*/

function formatTime(value) {
  if (!value) {
    return "Not available";
  }

  return new Date(
    Number(value) * 1000
  ).toLocaleString();
}

function formatKeycloakTime(value) {
  if (!value) {
    return "Not available";
  }

  return new Date(
    Number(value)
  ).toLocaleString();
}

function escapeHtml(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll(
      "'",
      "&#039;"
    );
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

  const response =
    await fetch(
      tokenUrl,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },

        body:
          new URLSearchParams({
            grant_type:
              "client_credentials",

            client_id:
              MONITOR_CLIENT_ID,

            client_secret:
              MONITOR_CLIENT_SECRET,
          }),
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Could not obtain monitor token. HTTP ${response.status}: ${text}`
    );
  }

  const data =
    await response.json();

  return data.access_token;
}

/*
|--------------------------------------------------------------------------
| KEYCLOAK ADMIN EVENTS API
|--------------------------------------------------------------------------
*/

async function getKeycloakEvents() {
  const accessToken =
    await getMonitorAccessToken();

  const eventsUrl =
    `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}` +
    `/events?max=100`;

  const response =
    await fetch(
      eventsUrl,
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
        },
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Could not retrieve Keycloak events. HTTP ${response.status}: ${text}`
    );
  }

  return response.json();
}

/*
|--------------------------------------------------------------------------
| EVENT USERNAME HELPER
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
| FIND MOST RECENT EVENT TIME
|--------------------------------------------------------------------------
|
| We use Keycloak's newest event as the reference point.
|
| This makes the detector useful for:
|   - live demonstrations
|   - previously recorded test events
|
*/

function getNewestEventTimestamp(
  events
) {
  if (
    !events ||
    events.length === 0
  ) {
    return Date.now();
  }

  return Math.max(
    ...events.map(
      (event) =>
        Number(
          event.time || 0
        )
    )
  );
}

/*
|--------------------------------------------------------------------------
| BASE KEYCLOAK EVENT ANALYSIS
|--------------------------------------------------------------------------
*/

function analyzeKeycloakEvents(
  events
) {
  const successfulLoginEvents =
    events.filter(
      (event) =>
        event.type === "LOGIN"
    );

  const failedLoginEvents =
    events.filter(
      (event) =>
        event.type ===
        "LOGIN_ERROR"
    );

  const lockoutEvents =
    events
      .filter(
        (event) =>
          event.type ===
          "USER_DISABLED_BY_TEMPORARY_LOCKOUT"
      )
      .sort(
        (a, b) =>
          Number(
            b.time || 0
          ) -
          Number(
            a.time || 0
          )
      );

  const reasonEvents =
    events.filter(
      (event) =>
        event.details?.reason ===
        "brute_force_attack_detected"
    );

  /*
    Avoid double counting a lockout event
    that also contains the brute-force reason.
  */

  const attackMap =
    new Map();

  for (
    const event of [
      ...lockoutEvents,
      ...reasonEvents,
    ]
  ) {
    const key = [
      event.time || "",
      event.type || "",
      event.userId || "",
      event.ipAddress || "",
    ].join("|");

    attackMap.set(
      key,
      event
    );
  }

  const bruteForceEvents =
    Array.from(
      attackMap.values()
    ).sort(
      (a, b) =>
        Number(
          b.time || 0
        ) -
        Number(
          a.time || 0
        )
    );

  const latestAttackEvent =
    bruteForceEvents[0] ||
    null;

  let attackUser =
    "Not available";

  if (latestAttackEvent) {
    const attackTimestamp =
      Number(
        latestAttackEvent.time ||
          0
      );

    /*
      Find a login error occurring shortly
      before the lockout so that we can
      resolve username when Keycloak gives
      only a userId in the lockout event.
    */

    const relatedLoginError =
      failedLoginEvents
        .filter(
          (event) => {
            const eventTime =
              Number(
                event.time ||
                  0
              );

            return (
              eventTime <=
                attackTimestamp &&
              attackTimestamp -
                eventTime <=
                60000
            );
          }
        )
        .sort(
          (a, b) =>
            Number(
              b.time || 0
            ) -
            Number(
              a.time || 0
            )
        )[0];

    attackUser =
      latestAttackEvent
        .details?.username ||
      relatedLoginError
        ?.details?.username ||
      latestAttackEvent.userId ||
      "Not available";
  }

  const attackIp =
    latestAttackEvent
      ?.ipAddress ||
    "Not available";

  const lastAttackTime =
    latestAttackEvent
      ? formatKeycloakTime(
          latestAttackEvent.time
        )
      : "Not available";

  return {
    totalEvents:
      events.length,

    successfulLogins:
      successfulLoginEvents.length,

    failedLogins:
      failedLoginEvents.length,

    bruteForceDetections:
      bruteForceEvents.length,

    temporaryLockouts:
      lockoutEvents.length,

    attackUser,
    attackIp,
    lastAttackTime,

    successfulLoginEvents,
    failedLoginEvents,
    lockoutEvents,
    bruteForceEvents,
  };
}

/*
|--------------------------------------------------------------------------
| INDEPENDENT DETECTION ENGINE
|--------------------------------------------------------------------------
|
| This is YOUR detection layer.
|
| It does not simply display Keycloak's result.
|
| It independently analyzes:
|
|   1. recent failed login frequency
|   2. same-IP concentration
|   3. same-username concentration
|   4. Keycloak lockout correlation
|
| Maximum score = 100.
|
*/

function runIndependentDetector(
  events
) {
  const newestTimestamp =
    getNewestEventTimestamp(
      events
    );

  const windowMilliseconds =
    RECENT_WINDOW_MINUTES *
    60 *
    1000;

  const windowStart =
    newestTimestamp -
    windowMilliseconds;

  /*
    Only authentication failures inside
    the recent analysis window.
  */

  const recentFailures =
    events.filter(
      (event) =>
        event.type ===
          "LOGIN_ERROR" &&
        Number(
          event.time || 0
        ) >= windowStart
    );

  /*
    Recent Keycloak lockout events.
  */

  const recentLockouts =
    events.filter(
      (event) =>
        event.type ===
          "USER_DISABLED_BY_TEMPORARY_LOCKOUT" &&
        Number(
          event.time || 0
        ) >= windowStart
    );

  /*
    Group failures by IP address.
  */

  const failuresByIp = {};

  for (
    const event of
      recentFailures
  ) {
    const ip =
      event.ipAddress ||
      "unknown";

    failuresByIp[ip] =
      (
        failuresByIp[ip] ||
        0
      ) + 1;
  }

  /*
    Group failures by username.
  */

  const failuresByUser = {};

  for (
    const event of
      recentFailures
  ) {
    const username =
      event.details
        ?.username ||
      "unknown";

    failuresByUser[
      username
    ] =
      (
        failuresByUser[
          username
        ] ||
        0
      ) + 1;
  }

  /*
    Find IP address with the most
    failed authentication attempts.
  */

  let highestFailureIp =
    "Not available";

  let highestIpFailureCount =
    0;

  for (
    const [
      ip,
      count,
    ] of Object.entries(
      failuresByIp
    )
  ) {
    if (
      count >
      highestIpFailureCount
    ) {
      highestFailureIp =
        ip;

      highestIpFailureCount =
        count;
    }
  }

  /*
    Find username with the most
    failed attempts.
  */

  let highestFailureUser =
    "Not available";

  let highestUserFailureCount =
    0;

  for (
    const [
      username,
      count,
    ] of Object.entries(
      failuresByUser
    )
  ) {
    if (
      count >
      highestUserFailureCount
    ) {
      highestFailureUser =
        username;

      highestUserFailureCount =
        count;
    }
  }

  /*
|--------------------------------------------------------------------------
| RISK SCORE
|--------------------------------------------------------------------------
*/

  let riskScore = 0;

  const signals = [];

  /*
    Signal 1:
    Failed-login volume.

    Maximum contribution = 40.
  */

  if (
    recentFailures.length > 0
  ) {
    const failureScore =
      Math.min(
        recentFailures.length *
          10,
        40
      );

    riskScore +=
      failureScore;

    signals.push(
      `${recentFailures.length} failed login attempt(s) detected within the last ${RECENT_WINDOW_MINUTES} minutes`
    );
  }

  /*
    Signal 2:
    Repeated failures from the
    same source IP.

    Contribution = 20.
  */

  if (
    highestIpFailureCount >=
    FAILED_LOGIN_THRESHOLD
  ) {
    riskScore += 20;

    signals.push(
      `Repeated failures detected from IP ${highestFailureIp} (${highestIpFailureCount} attempts)`
    );
  }

  /*
    Signal 3:
    Repeated attacks against the
    same username.

    Contribution = 20.
  */

  if (
    highestUserFailureCount >=
    FAILED_LOGIN_THRESHOLD
  ) {
    riskScore += 20;

    signals.push(
      `Repeated authentication failures targeted user ${highestFailureUser} (${highestUserFailureCount} attempts)`
    );
  }

  /*
    Signal 4:
    Keycloak confirmed a temporary
    account lockout.

    Contribution = 40.

    This correlates our independent
    analysis with Keycloak mitigation.
  */

  if (
    recentLockouts.length > 0
  ) {
    riskScore += 40;

    signals.push(
      `Keycloak temporary lockout detected (${recentLockouts.length} recent lockout event(s))`
    );
  }

  /*
    Do not allow score above 100.
  */

  riskScore =
    Math.min(
      riskScore,
      100
    );

  /*
|--------------------------------------------------------------------------
| CUSTOM CLASSIFICATION
|--------------------------------------------------------------------------
*/

  let classification =
    "LOW";

  if (
    riskScore >= 30 &&
    riskScore < 60
  ) {
    classification =
      "MEDIUM";
  }

  if (
    riskScore >= 60
  ) {
    classification =
      "HIGH";
  }

  /*
|--------------------------------------------------------------------------
| KEYCLOAK ASSESSMENT
|--------------------------------------------------------------------------
|
| We independently calculate a
| simplified Keycloak-side assessment
| for comparison.
|
*/

  let keycloakAssessment =
    "LOW";

  if (
    recentFailures.length >=
    FAILED_LOGIN_THRESHOLD
  ) {
    keycloakAssessment =
      "MEDIUM";
  }

  if (
    recentLockouts.length > 0
  ) {
    keycloakAssessment =
      "HIGH";
  }

  /*
|--------------------------------------------------------------------------
| DETECTOR COMPARISON
|--------------------------------------------------------------------------
*/

  const comparison =
    classification ===
    keycloakAssessment
      ? "MATCH"
      : "MISMATCH";

  return {
    analysisWindowMinutes:
      RECENT_WINDOW_MINUTES,

    newestTimestamp,

    windowStart,

    recentFailureCount:
      recentFailures.length,

    recentLockoutCount:
      recentLockouts.length,

    highestFailureIp,

    highestIpFailureCount,

    highestFailureUser,

    highestUserFailureCount,

    riskScore,

    classification,

    keycloakAssessment,

    comparison,

    signals,
  };
}

/*
|--------------------------------------------------------------------------
| CSS
|--------------------------------------------------------------------------
*/

function dashboardStyles() {
  return `
    <style>

      * {
        box-sizing: border-box;
      }

      body {
        font-family:
          Arial,
          sans-serif;

        margin: 0;
        padding: 30px;

        background:
          #f5f7fa;

        color:
          #222;
      }

      h1 {
        margin-top: 0;
      }

      h2 {
        margin-top: 25px;
      }

      .topbar {
        margin-bottom: 25px;
      }

      .cards {
        display: flex;
        flex-wrap: wrap;

        gap: 18px;

        margin-top: 20px;
        margin-bottom: 35px;
      }

      .card {
        background: white;

        border:
          1px solid #ddd;

        border-radius:
          8px;

        padding:
          22px;

        min-width:
          210px;

        box-shadow:
          0 2px 5px
          rgba(
            0,
            0,
            0,
            0.08
          );
      }

      .card h3 {
        margin-top: 0;
        font-size: 17px;
      }

      .number {
        font-size: 34px;
        font-weight: bold;
        margin-top: 12px;
      }

      .alert {
        background:
          #ffe8e8;

        border:
          2px solid
          #d32f2f;

        border-radius:
          8px;

        padding:
          25px;

        margin-top:
          25px;

        margin-bottom:
          35px;
      }

      .engine-box {
        background:
          white;

        border:
          2px solid
          #345995;

        border-radius:
          8px;

        padding:
          25px;

        margin-top:
          25px;

        margin-bottom:
          35px;
      }

      .engine-result {
        font-size:
          24px;

        font-weight:
          bold;
      }

      .match {
        font-weight:
          bold;

        color:
          #1b5e20;
      }

      .mismatch {
        font-weight:
          bold;

        color:
          #b00020;
      }

      .risk-high {
        color:
          #b00020;

        font-weight:
          bold;
      }

      .risk-medium {
        color:
          #a65f00;

        font-weight:
          bold;
      }

      .risk-low {
        color:
          #1b5e20;

        font-weight:
          bold;
      }

      .status-box {
        background:
          white;

        border:
          1px solid #ddd;

        border-radius:
          8px;

        padding:
          20px;

        margin-top:
          20px;

        margin-bottom:
          25px;
      }

      table {
        border-collapse:
          collapse;

        width:
          100%;

        background:
          white;

        margin-top:
          15px;
      }

      th,
      td {
        border:
          1px solid
          #ccc;

        padding:
          12px;

        text-align:
          left;

        vertical-align:
          top;
      }

      th {
        background:
          #eee;
      }

      .links {
        margin-top:
          30px;
      }

      .links a {
        margin-right:
          25px;
      }

      .score {
        font-size:
          42px;

        font-weight:
          bold;
      }

      .signal-list li {
        margin-bottom:
          10px;
      }

    </style>
  `;
}

/*
|--------------------------------------------------------------------------
| APPLICATION STARTUP
|--------------------------------------------------------------------------
*/

async function start() {
  const client =
    await import(
      "openid-client"
    );

  const issuer =
    new URL(
      `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`
    );

  const clientId =
    "research-app";

  /*
    Discover Keycloak OIDC endpoints.
  */

  const config =
    await client.discovery(
      issuer,
      clientId,
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
| HOME PAGE
|--------------------------------------------------------------------------
*/

  app.get(
    "/",
    (req, res) => {
      if (
        !req.session.user
      ) {
        return res.send(`
          ${dashboardStyles()}

          <h1>
            Web2 Security Research Application
          </h1>

          <div class="status-box">

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

          </div>
        `);
      }

      const user =
        req.session.user;

      res.send(`
        ${dashboardStyles()}

        <h1>
          Web2 Security Research Application
        </h1>

        <h2>
          Protected OAuth 2.0 / OIDC Dashboard
        </h2>

        <div class="status-box">

          <p>
            <strong>
              Authentication Status:
            </strong>

            Authenticated
          </p>

        </div>

        <h3>
          User Information
        </h3>

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

        <hr>

        <h3>
          Token Information
        </h3>

        <p>
          <strong>
            Token Issued At:
          </strong>

          ${formatTime(
            user.iat
          )}
        </p>

        <p>
          <strong>
            Token Expires At:
          </strong>

          ${formatTime(
            user.exp
          )}
        </p>

        <hr>

        <h3>
          Security Monitoring
        </h3>

        <p>
          <a href="/security-dashboard">
            Open Security Detection Dashboard
          </a>
        </p>

        <p>
          <a href="/keycloak-events">
            View Raw Keycloak Security Events
          </a>
        </p>

        <p>
          <a href="/security-events">
            View Application Security Events
          </a>
        </p>

        <hr>

        <p>
          <a href="/logout">
            Logout
          </a>
        </p>
      `);
    }
  );

  /*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
*/

  app.get(
    "/login",
    async (
      req,
      res
    ) => {
      const codeVerifier =
        client
          .randomPKCECodeVerifier();

      const codeChallenge =
        await client
          .calculatePKCECodeChallenge(
            codeVerifier
          );

      req.session.codeVerifier =
        codeVerifier;

      const authorizationUrl =
        client
          .buildAuthorizationUrl(
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
    }
  );

  /*
|--------------------------------------------------------------------------
| CALLBACK
|--------------------------------------------------------------------------
*/

  app.get(
    "/callback",
    async (
      req,
      res
    ) => {
      try {
        const currentUrl =
          new URL(
            req.protocol +
              "://" +
              req.get(
                "host"
              ) +
              req.originalUrl
          );

        const tokens =
          await client
            .authorizationCodeGrant(
              config,
              currentUrl,
              {
                pkceCodeVerifier:
                  req.session
                    .codeVerifier,

                idTokenExpected:
                  true,
              }
            );

        const claims =
          tokens.claims();

        req.session.user =
          claims;

        addSecurityEvent(
          "LOGIN_SUCCESS",

          claims
            .preferred_username,

          "OAuth/OIDC authentication completed successfully"
        );

        res.redirect("/");
      } catch (error) {
        console.error(
          error
        );

        addSecurityEvent(
          "AUTHENTICATION_ERROR",
          "unknown",
          error.message
        );

        res
          .status(500)
          .send(`
            ${dashboardStyles()}

            <h1>
              Authentication Failed
            </h1>

            <p>
              ${escapeHtml(
                error.message
              )}
            </p>

            <a href="/">
              Return Home
            </a>
          `);
      }
    }
  );

  /*
|--------------------------------------------------------------------------
| SECURITY DETECTION DASHBOARD
|--------------------------------------------------------------------------
*/

  app.get(
    "/security-dashboard",
    async (
      req,
      res
    ) => {
      if (
        !req.session.user
      ) {
        return res
          .status(401)
          .send(`
            ${dashboardStyles()}

            <h1>
              Access Denied
            </h1>

            <p>
              You must be logged in.
            </p>

            <a href="/">
              Return Home
            </a>
          `);
      }

      try {
        const events =
          await getKeycloakEvents();

        /*
          Layer 1:
          Keycloak event analysis.
        */

        const keycloak =
          analyzeKeycloakEvents(
            events
          );

        /*
          Layer 2:
          Independent detector.
        */

        const detector =
          runIndependentDetector(
            events
          );

        /*
          Determine visible risk styling
          from our independent detector.
        */

        let riskClass =
          "risk-low";

        if (
          detector.classification ===
          "MEDIUM"
        ) {
          riskClass =
            "risk-medium";
        }

        if (
          detector.classification ===
          "HIGH"
        ) {
          riskClass =
            "risk-high";
        }

        /*
          Keycloak high-risk alert.
        */

        let attackAlert = `
          <div class="status-box">

            <h2>
              No Confirmed Keycloak Lockout
            </h2>

            <p>
              No Keycloak temporary
              lockout has been detected.
            </p>

          </div>
        `;

        if (
          keycloak
            .temporaryLockouts >
          0
        ) {
          attackAlert = `
            <div class="alert">

              <h2>
                HIGH-RISK SECURITY ALERT
              </h2>

              <p>
                <strong>
                  Attack Type:
                </strong>

                Brute-Force Authentication Attack
              </p>

              <p>
                <strong>
                  Target User:
                </strong>

                ${escapeHtml(
                  keycloak
                    .attackUser
                )}
              </p>

              <p>
                <strong>
                  Source IP:
                </strong>

                ${escapeHtml(
                  keycloak
                    .attackIp
                )}
              </p>

              <p>
                <strong>
                  Failed Login Attempts:
                </strong>

                ${keycloak
                  .failedLogins}
              </p>

              <p>
                <strong>
                  Brute-Force Detections:
                </strong>

                ${keycloak
                  .bruteForceDetections}
              </p>

              <p>
                <strong>
                  Temporary Lockouts:
                </strong>

                ${keycloak
                  .temporaryLockouts}
              </p>

              <p>
                <strong>
                  Keycloak Response:
                </strong>

                Account temporarily locked
              </p>

              <p>
                <strong>
                  Last Detection Time:
                </strong>

                ${escapeHtml(
                  keycloak
                    .lastAttackTime
                )}
              </p>

              <p>
                <strong>
                  Status:
                </strong>

                Attack mitigated by
                Keycloak brute-force protection
              </p>

            </div>
          `;
        }

        /*
          Build independent detector
          signal list.
        */

        let signalHtml =
          "";

        if (
          detector.signals.length ===
          0
        ) {
          signalHtml = `
            <li>
              No suspicious recent
              authentication signals detected.
            </li>
          `;
        } else {
          signalHtml =
            detector.signals
              .map(
                (signal) => `
                  <li>
                    ${escapeHtml(
                      signal
                    )}
                  </li>
                `
              )
              .join("");
        }

        const comparisonClass =
          detector.comparison ===
          "MATCH"
            ? "match"
            : "mismatch";

        /*
          Render dashboard.
        */

        res.send(`
          ${dashboardStyles()}

          <div class="topbar">

            <h1>
              Security Detection Dashboard
            </h1>

            <h2 class="${riskClass}">
              Custom Detector Risk:
              ${detector.classification}
            </h2>

          </div>

          ${attackAlert}

          <h2>
            Independent Detection Engine
          </h2>

          <div class="engine-box">

            <p>
              <strong>
                Analysis Window:
              </strong>

              Last
              ${detector.analysisWindowMinutes}
              minutes
            </p>

            <p>
              <strong>
                Risk Score:
              </strong>
            </p>

            <div class="score">
              ${detector.riskScore}
              / 100
            </div>

            <p class="engine-result ${riskClass}">
              Classification:
              ${detector.classification}
            </p>

            <hr>

            <h3>
              Signals Detected
            </h3>

            <ul class="signal-list">
              ${signalHtml}
            </ul>

            <hr>

            <h3>
              Authentication Pattern
            </h3>

            <p>
              <strong>
                Recent Failed Logins:
              </strong>

              ${detector
                .recentFailureCount}
            </p>

            <p>
              <strong>
                Most Active Source IP:
              </strong>

              ${escapeHtml(
                detector
                  .highestFailureIp
              )}

              (${detector
                .highestIpFailureCount}
              failed attempt(s))
            </p>

            <p>
              <strong>
                Most Targeted User:
              </strong>

              ${escapeHtml(
                detector
                  .highestFailureUser
              )}

              (${detector
                .highestUserFailureCount}
              failed attempt(s))
            </p>

            <p>
              <strong>
                Recent Keycloak Lockouts:
              </strong>

              ${detector
                .recentLockoutCount}
            </p>

            <hr>

            <h3>
              Detection Correlation
            </h3>

            <p>
              <strong>
                Keycloak Assessment:
              </strong>

              ${detector
                .keycloakAssessment}
            </p>

            <p>
              <strong>
                Custom Detector Assessment:
              </strong>

              ${detector
                .classification}
            </p>

            <p>
              <strong>
                Result:
              </strong>

              <span class="${comparisonClass}">
                ${detector
                  .comparison}
              </span>
            </p>

          </div>

          <h2>
            Historical Security Statistics
          </h2>

          <div class="cards">

            <div class="card">

              <h3>
                Total Events
              </h3>

              <div class="number">
                ${keycloak
                  .totalEvents}
              </div>

            </div>

            <div class="card">

              <h3>
                Successful Logins
              </h3>

              <div class="number">
                ${keycloak
                  .successfulLogins}
              </div>

            </div>

            <div class="card">

              <h3>
                Failed Logins
              </h3>

              <div class="number">
                ${keycloak
                  .failedLogins}
              </div>

            </div>

            <div class="card">

              <h3>
                Brute Force Detections
              </h3>

              <div class="number">
                ${keycloak
                  .bruteForceDetections}
              </div>

            </div>

            <div class="card">

              <h3>
                Temporary Lockouts
              </h3>

              <div class="number">
                ${keycloak
                  .temporaryLockouts}
              </div>

            </div>

          </div>

          <h2>
            Custom Detection Rules
          </h2>

          <table>

            <tr>
              <th>
                Signal
              </th>

              <th>
                Score
              </th>
            </tr>

            <tr>
              <td>
                Recent failed login
              </td>

              <td>
                +10 each,
                maximum +40
              </td>
            </tr>

            <tr>
              <td>
                3+ failures from same IP
              </td>

              <td>
                +20
              </td>
            </tr>

            <tr>
              <td>
                3+ failures against same user
              </td>

              <td>
                +20
              </td>
            </tr>

            <tr>
              <td>
                Recent Keycloak temporary lockout
              </td>

              <td>
                +40
              </td>
            </tr>

          </table>

          <h2>
            Risk Classification
          </h2>

          <table>

            <tr>
              <th>
                Score
              </th>

              <th>
                Classification
              </th>
            </tr>

            <tr>
              <td>
                0–29
              </td>

              <td>
                LOW
              </td>
            </tr>

            <tr>
              <td>
                30–59
              </td>

              <td>
                MEDIUM
              </td>
            </tr>

            <tr>
              <td>
                60–100
              </td>

              <td>
                HIGH
              </td>
            </tr>

          </table>

          <div class="links">

            <a href="/keycloak-events">
              View Raw Keycloak Events
            </a>

            <a href="/security-events">
              View Application Events
            </a>

            <a href="/">
              Return to Main Dashboard
            </a>

          </div>
        `);
      } catch (error) {
        console.error(
          error
        );

        res
          .status(500)
          .send(`
            ${dashboardStyles()}

            <h1>
              Security Analysis Failed
            </h1>

            <p>
              ${escapeHtml(
                error.message
              )}
            </p>

            <a href="/">
              Return Home
            </a>
          `);
      }
    }
  );

  /*
|--------------------------------------------------------------------------
| RAW KEYCLOAK EVENTS
|--------------------------------------------------------------------------
*/

  app.get(
    "/keycloak-events",
    async (
      req,
      res
    ) => {
      if (
        !req.session.user
      ) {
        return res
          .status(401)
          .send(`
            ${dashboardStyles()}

            <h1>
              Access Denied
            </h1>

            <p>
              You must be logged in.
            </p>

            <a href="/">
              Return Home
            </a>
          `);
      }

      try {
        const events =
          await getKeycloakEvents();

        events.sort(
          (a, b) =>
            Number(
              b.time || 0
            ) -
            Number(
              a.time || 0
            )
        );

        const rows =
          events
            .map(
              (event) => {
                const username =
                  getEventUsername(
                    event
                  );

                const error =
                  event.error ||
                  event.details
                    ?.error ||
                  "";

                const reason =
                  event.details
                    ?.reason ||
                  "";

                return `
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
                        username
                      )}
                    </td>

                    <td>
                      ${escapeHtml(
                        event.ipAddress ||
                          "Not available"
                      )}
                    </td>

                    <td>
                      ${escapeHtml(
                        event.clientId ||
                          "Not available"
                      )}
                    </td>

                    <td>
                      ${escapeHtml(
                        error
                      )}
                    </td>

                    <td>
                      ${escapeHtml(
                        reason
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
            Keycloak Security Event Monitor
          </h1>

          <p>
            Events retrieved directly
            from Keycloak using the
            security-monitor service account.
          </p>

          <table>

            <tr>

              <th>
                Time
              </th>

              <th>
                Event Type
              </th>

              <th>
                User
              </th>

              <th>
                IP Address
              </th>

              <th>
                Client
              </th>

              <th>
                Error
              </th>

              <th>
                Reason
              </th>

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
        console.error(
          error
        );

        res
          .status(500)
          .send(`
            ${dashboardStyles()}

            <h1>
              Keycloak Event Retrieval Failed
            </h1>

            <p>
              ${escapeHtml(
                error.message
              )}
            </p>

            <a href="/">
              Return Home
            </a>
          `);
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
    (
      req,
      res
    ) => {
      if (
        !req.session.user
      ) {
        return res
          .status(401)
          .send(`
            ${dashboardStyles()}

            <h1>
              Access Denied
            </h1>

            <p>
              You must be logged in.
            </p>

            <a href="/">
              Return Home
            </a>
          `);
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

        <p>
          Logged in as:

          <strong>
            ${escapeHtml(
              req.session.user
                .preferred_username
            )}
          </strong>
        </p>

        <p>
          Security events are stored
          persistently in:

          <strong>
            security-events.json
          </strong>
        </p>

        <table>

          <tr>

            <th>
              Time
            </th>

            <th>
              Event Type
            </th>

            <th>
              Username
            </th>

            <th>
              Details
            </th>

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
    (
      req,
      res
    ) => {
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
        `Security events stored in: ${LOG_FILE}`
      );

      console.log(
        "Keycloak security monitoring enabled"
      );

      console.log(
        "Independent detection engine enabled"
      );

      console.log(
        `Detection window: ${RECENT_WINDOW_MINUTES} minutes`
      );

      console.log(
        `Failed-login threshold: ${FAILED_LOGIN_THRESHOLD}`
      );
    }
  );
}

/*
|--------------------------------------------------------------------------
| START APPLICATION
|--------------------------------------------------------------------------
*/

start().catch(
  (error) => {
    console.error(
      "Application startup failed:",
      error
    );
  }
);