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

app.use(
  session({
    secret: "research-app-secret",
    resave: false,
    saveUninitialized: false,
  })
);

function loadSecurityEvents() {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return [];
    }

    const data = fs.readFileSync(LOG_FILE, "utf8");

    if (!data.trim()) {
      return [];
    }

    return JSON.parse(data);
  } catch (error) {
    console.error("Could not read security events:", error);
    return [];
  }
}

let securityEvents = loadSecurityEvents();

function saveSecurityEvents() {
  fs.writeFileSync(
    LOG_FILE,
    JSON.stringify(securityEvents, null, 2),
    "utf8"
  );
}

function addSecurityEvent(type, username, details) {
  securityEvents.unshift({
    time: new Date().toLocaleString(),
    type,
    username: username || "unknown",
    details: details || "",
  });

  if (securityEvents.length > 100) {
    securityEvents = securityEvents.slice(0, 100);
  }

  saveSecurityEvents();
}

function formatTime(value) {
  if (!value) return "Not available";
  return new Date(value * 1000).toLocaleString();
}

function formatKeycloakTime(value) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString();
}

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

function analyzeEvents(events) {
  let successfulLogins = 0;
  let failedLogins = 0;
  let bruteForceDetections = 0;
  let temporaryLockouts = 0;

  let attackUser = "Not available";
  let attackIp = "Not available";
  let lastAttackTime = "Not available";

  for (const event of events) {
    if (event.type === "LOGIN") {
      successfulLogins++;
    }

    if (event.type === "LOGIN_ERROR") {
      failedLogins++;

      if (event.details?.username) {
        attackUser = event.details.username;
      }

      if (event.ipAddress) {
        attackIp = event.ipAddress;
      }
    }

    if (
      event.type === "USER_DISABLED_BY_TEMPORARY_LOCKOUT"
    ) {
      temporaryLockouts++;
      bruteForceDetections++;

      if (event.ipAddress) {
        attackIp = event.ipAddress;
      }

      if (event.time) {
        lastAttackTime = formatKeycloakTime(event.time);
      }
    }

    if (
      event.details?.reason === "brute_force_attack_detected"
    ) {
      bruteForceDetections++;

      if (event.details?.username) {
        attackUser = event.details.username;
      }

      if (event.ipAddress) {
        attackIp = event.ipAddress;
      }

      if (event.time) {
        lastAttackTime = formatKeycloakTime(event.time);
      }
    }
  }

  if (
    bruteForceDetections > 1 &&
    temporaryLockouts === 1
  ) {
    bruteForceDetections = 1;
  }

  let riskLevel = "LOW";

  if (failedLogins >= 3) {
    riskLevel = "MEDIUM";
  }

  if (
    bruteForceDetections > 0 ||
    temporaryLockouts > 0
  ) {
    riskLevel = "HIGH";
  }

  return {
    totalEvents: events.length,
    successfulLogins,
    failedLogins,
    bruteForceDetections,
    temporaryLockouts,
    riskLevel,
    attackUser,
    attackIp,
    lastAttackTime,
  };
}

function dashboardStyles() {
  return `
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 30px;
        background: #f5f7fa;
        color: #222;
      }

      h1 {
        margin-bottom: 10px;
      }

      .topbar {
        margin-bottom: 25px;
      }

      .cards {
        display: flex;
        flex-wrap: wrap;
        gap: 15px;
        margin-top: 20px;
        margin-bottom: 30px;
      }

      .card {
        background: white;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 20px;
        width: 190px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.08);
      }

      .card h3 {
        margin-top: 0;
        font-size: 16px;
      }

      .number {
        font-size: 30px;
        font-weight: bold;
      }

      .alert {
        background: #ffe8e8;
        border: 2px solid #d32f2f;
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 30px;
      }

      .alert h2 {
        margin-top: 0;
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

      table {
        border-collapse: collapse;
        background: white;
      }

      th, td {
        border: 1px solid #ccc;
        padding: 10px;
        text-align: left;
      }

      th {
        background: #eee;
      }

      .links {
        margin-top: 25px;
      }

      .links a {
        margin-right: 20px;
      }
    </style>
  `;
}

async function start() {
  const client = await import("openid-client");

  const issuer = new URL(
    `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`
  );

  const clientId = "research-app";

  const config = await client.discovery(
    issuer,
    clientId,
    undefined,
    client.None(),
    {
      execute: [client.allowInsecureRequests],
    }
  );

  app.get("/", (req, res) => {
    if (!req.session.user) {
      return res.send(`
        ${dashboardStyles()}

        <h1>Web2 Security Research Application</h1>

        <p>
          <strong>Authentication Status:</strong>
          Not authenticated
        </p>

        <p>
          <a href="/login">Login with Keycloak</a>
        </p>
      `);
    }

    const user = req.session.user;

    res.send(`
      ${dashboardStyles()}

      <h1>Web2 Security Research Application</h1>

      <h2>Protected OAuth 2.0 / OIDC Dashboard</h2>

      <p>
        <strong>Authentication Status:</strong>
        Authenticated
      </p>

      <hr>

      <h3>User Information</h3>

      <p>
        <strong>Username:</strong>
        ${escapeHtml(user.preferred_username)}
      </p>

      <p>
        <strong>Email:</strong>
        ${escapeHtml(user.email)}
      </p>

      <p>
        <strong>User ID:</strong>
        ${escapeHtml(user.sub)}
      </p>

      <hr>

      <h3>Token Information</h3>

      <p>
        <strong>Token Issued At:</strong>
        ${formatTime(user.iat)}
      </p>

      <p>
        <strong>Token Expires At:</strong>
        ${formatTime(user.exp)}
      </p>

      <hr>

      <h3>Security Monitoring</h3>

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
        <a href="/logout">Logout</a>
      </p>
    `);
  });

  app.get("/login", async (req, res) => {
    const codeVerifier =
      client.randomPKCECodeVerifier();

    const codeChallenge =
      await client.calculatePKCECodeChallenge(
        codeVerifier
      );

    req.session.codeVerifier = codeVerifier;

    const authorizationUrl =
      client.buildAuthorizationUrl(config, {
        redirect_uri:
          "http://localhost:3000/callback",
        scope:
          "openid profile email",
        code_challenge:
          codeChallenge,
        code_challenge_method:
          "S256",
      });

    res.redirect(authorizationUrl.href);
  });

  app.get("/callback", async (req, res) => {
    try {
      const currentUrl = new URL(
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

      const claims = tokens.claims();

      req.session.user = claims;

      addSecurityEvent(
        "LOGIN_SUCCESS",
        claims.preferred_username,
        "OAuth/OIDC authentication completed successfully"
      );

      res.redirect("/");
    } catch (error) {
      console.error(error);

      addSecurityEvent(
        "AUTHENTICATION_ERROR",
        "unknown",
        error.message
      );

      res.status(500).send(
        "Login failed. Check the Command Prompt."
      );
    }
  });

  app.get(
    "/security-dashboard",
    async (req, res) => {
      if (!req.session.user) {
        return res.status(401).send(`
          ${dashboardStyles()}
          <h1>Access Denied</h1>
          <p>You must be logged in.</p>
          <a href="/">Return Home</a>
        `);
      }

      try {
        const events =
          await getKeycloakEvents();

        const analysis =
          analyzeEvents(events);

        let riskClass = "risk-low";

        if (analysis.riskLevel === "MEDIUM") {
          riskClass = "risk-medium";
        }

        if (analysis.riskLevel === "HIGH") {
          riskClass = "risk-high";
        }

        let attackAlert = `
          <div class="alert">
            <h2>No Active High-Risk Attack Detected</h2>
            <p>
              Current authentication activity does not show
              a confirmed brute-force lockout event.
            </p>
          </div>
        `;

        if (analysis.riskLevel === "HIGH") {
          attackAlert = `
            <div class="alert">
              <h2>HIGH-RISK SECURITY ALERT</h2>

              <p>
                <strong>Attack Type:</strong>
                Brute-Force Authentication Attack
              </p>

              <p>
                <strong>Target User:</strong>
                ${escapeHtml(analysis.attackUser)}
              </p>

              <p>
                <strong>Source IP:</strong>
                ${escapeHtml(analysis.attackIp)}
              </p>

              <p>
                <strong>Failed Login Attempts:</strong>
                ${analysis.failedLogins}
              </p>

              <p>
                <strong>Brute-Force Detections:</strong>
                ${analysis.bruteForceDetections}
              </p>

              <p>
                <strong>Temporary Lockouts:</strong>
                ${analysis.temporaryLockouts}
              </p>

              <p>
                <strong>Keycloak Response:</strong>
                Account temporarily locked
              </p>

              <p>
                <strong>Last Detection Time:</strong>
                ${escapeHtml(analysis.lastAttackTime)}
              </p>

              <p>
                <strong>Status:</strong>
                Attack mitigated by Keycloak brute-force protection
              </p>
            </div>
          `;
        }

        res.send(`
          ${dashboardStyles()}

          <div class="topbar">
            <h1>Security Detection Dashboard</h1>

            <h2 class="${riskClass}">
              Current Risk Level:
              ${analysis.riskLevel}
            </h2>
          </div>

          ${attackAlert}

          <h2>Security Statistics</h2>

          <div class="cards">

            <div class="card">
              <h3>Total Events</h3>
              <div class="number">
                ${analysis.totalEvents}
              </div>
            </div>

            <div class="card">
              <h3>Successful Logins</h3>
              <div class="number">
                ${analysis.successfulLogins}
              </div>
            </div>

            <div class="card">
              <h3>Failed Logins</h3>
              <div class="number">
                ${analysis.failedLogins}
              </div>
            </div>

            <div class="card">
              <h3>Brute Force Detections</h3>
              <div class="number">
                ${analysis.bruteForceDetections}
              </div>
            </div>

            <div class="card">
              <h3>Temporary Lockouts</h3>
              <div class="number">
                ${analysis.temporaryLockouts}
              </div>
            </div>

          </div>

          <h2>Detection Rules</h2>

          <table>
            <tr>
              <th>Risk Level</th>
              <th>Condition</th>
            </tr>

            <tr>
              <td>LOW</td>
              <td>
                Normal authentication activity
              </td>
            </tr>

            <tr>
              <td>MEDIUM</td>
              <td>
                Three or more failed login attempts
              </td>
            </tr>

            <tr>
              <td>HIGH</td>
              <td>
                Brute-force detection or
                temporary account lockout
              </td>
            </tr>
          </table>

          <div class="links">
            <a href="/keycloak-events">
              View Raw Keycloak Events
            </a>

            <a href="/">
              Return to Main Dashboard
            </a>
          </div>
        `);
      } catch (error) {
        console.error(error);

        res.status(500).send(`
          ${dashboardStyles()}

          <h1>Security Analysis Failed</h1>

          <p>${escapeHtml(error.message)}</p>

          <a href="/">Return Home</a>
        `);
      }
    }
  );

  app.get(
    "/keycloak-events",
    async (req, res) => {
      if (!req.session.user) {
        return res.status(401).send(`
          ${dashboardStyles()}
          <h1>Access Denied</h1>
          <p>You must be logged in.</p>
          <a href="/">Return Home</a>
        `);
      }

      try {
        const events =
          await getKeycloakEvents();

        const rows = events
          .map((event) => {
            const username =
              event.details?.username ||
              event.userId ||
              "unknown";

            const error =
              event.error ||
              event.details?.error ||
              "";

            const reason =
              event.details?.reason ||
              "";

            return `
              <tr>
                <td>${formatKeycloakTime(event.time)}</td>
                <td>${escapeHtml(event.type)}</td>
                <td>${escapeHtml(username)}</td>
                <td>${escapeHtml(event.ipAddress)}</td>
                <td>${escapeHtml(event.clientId)}</td>
                <td>${escapeHtml(error)}</td>
                <td>${escapeHtml(reason)}</td>
              </tr>
            `;
          })
          .join("");

        res.send(`
          ${dashboardStyles()}

          <h1>Keycloak Security Event Monitor</h1>

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
            <a href="/">
              Return to Dashboard
            </a>
          </div>
        `);
      } catch (error) {
        console.error(error);

        res.status(500).send(
          escapeHtml(error.message)
        );
      }
    }
  );

  app.get(
    "/security-events",
    (req, res) => {
      if (!req.session.user) {
        return res.status(401).send(
          "Access denied."
        );
      }

      const rows =
        securityEvents
          .map(
            (event) => `
              <tr>
                <td>${escapeHtml(event.time)}</td>
                <td>${escapeHtml(event.type)}</td>
                <td>${escapeHtml(event.username)}</td>
                <td>${escapeHtml(event.details)}</td>
              </tr>
            `
          )
          .join("");

      res.send(`
        ${dashboardStyles()}

        <h1>Application Security Monitor</h1>

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
          <a href="/">
            Return to Dashboard
          </a>
        </div>
      `);
    }
  );

  app.get("/logout", (req, res) => {
    const username =
      req.session.user?.preferred_username ||
      "unknown";

    addSecurityEvent(
      "LOGOUT",
      username,
      "Application session terminated"
    );

    req.session.destroy(() => {
      res.redirect("/");
    });
  });

  app.listen(PORT, () => {
    console.log(
      `Research application running at http://localhost:${PORT}`
    );

    console.log(
      "Professional security dashboard enabled"
    );
  });
}

start().catch(console.error);