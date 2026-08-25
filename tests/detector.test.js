const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterExperimentEvents,
  runIndependentDetector,
  classifyExperimentOutcome,
} = require("../index.js");


function loginError(
  time,
  ip = "10.0.0.5",
  username = "testuser"
) {
  return {
    time,
    type: "LOGIN_ERROR",
    ipAddress: ip,
    details: {
      username,
    },
  };
}


function lockout(
  time,
  ip = "10.0.0.5",
  username = "testuser"
) {
  return {
    time,
    type: "USER_DISABLED_BY_TEMPORARY_LOCKOUT",
    ipAddress: ip,
    details: {
      username,
    },
  };
}


/*
|--------------------------------------------------------------------------
| TEST 1
| Experiment window
|--------------------------------------------------------------------------
*/

test(
  "only events inside experiment window are included",
  () => {

    const events = [
      loginError(999),
      loginError(1000),
      loginError(1500),
      loginError(2000),
      loginError(2001),
    ];

    const result =
      filterExperimentEvents(
        events,
        1000,
        2000
      );

    assert.equal(
      result.length,
      3
    );
  }
);


/*
|--------------------------------------------------------------------------
| TEST 2
| Zero failures
|--------------------------------------------------------------------------
*/

test(
  "zero failures produces LOW NORMAL",
  () => {

    const result =
      runIndependentDetector([]);

    assert.equal(
      result.riskScore,
      0
    );

    assert.equal(
      result.classification,
      "LOW"
    );

    assert.equal(
      result.customPrediction,
      "NORMAL"
    );
  }
);


/*
|--------------------------------------------------------------------------
| TEST 3
| One failed login
|--------------------------------------------------------------------------
*/

test(
  "one failure produces risk score 10",
  () => {

    const result =
      runIndependentDetector([
        loginError(1000),
      ]);

    assert.equal(
      result.failedLoginCount,
      1
    );

    assert.equal(
      result.riskScore,
      10
    );

    assert.equal(
      result.classification,
      "LOW"
    );

    assert.equal(
      result.customPrediction,
      "NORMAL"
    );
  }
);


/*
|--------------------------------------------------------------------------
| TEST 4
| Two failed logins
|--------------------------------------------------------------------------
*/

test(
  "two failures produce risk score 20",
  () => {

    const result =
      runIndependentDetector([
        loginError(1000),
        loginError(1100),
      ]);

    assert.equal(
      result.failedLoginCount,
      2
    );

    assert.equal(
      result.riskScore,
      20
    );

    assert.equal(
      result.classification,
      "LOW"
    );

    assert.equal(
      result.customPrediction,
      "NORMAL"
    );
  }
);


/*
|--------------------------------------------------------------------------
| TEST 5
| Three distributed failures
|--------------------------------------------------------------------------
*/

test(
  "three distributed failures produce MEDIUM ATTACK",
  () => {

    const result =
      runIndependentDetector([

        loginError(
          1000,
          "10.0.0.1",
          "user1"
        ),

        loginError(
          1100,
          "10.0.0.2",
          "user2"
        ),

        loginError(
          1200,
          "10.0.0.3",
          "user3"
        ),

      ]);

    assert.equal(
      result.failedLoginCount,
      3
    );

    assert.equal(
      result.riskScore,
      30
    );

    assert.equal(
      result.classification,
      "MEDIUM"
    );

    assert.equal(
      result.customPrediction,
      "ATTACK"
    );
  }
);


/*
|--------------------------------------------------------------------------
| TEST 6
| Same IP and same user
|--------------------------------------------------------------------------
*/

test(
  "three repeated failures produce HIGH ATTACK",
  () => {

    const result =
      runIndependentDetector([
        loginError(1000),
        loginError(1100),
        loginError(1200),
      ]);

    assert.equal(
      result.failedLoginCount,
      3
    );

    assert.equal(
      result.highestIpFailureCount,
      3
    );

    assert.equal(
      result.highestUserFailureCount,
      3
    );

    assert.equal(
      result.riskScore,
      70
    );

    assert.equal(
      result.classification,
      "HIGH"
    );

    assert.equal(
      result.customPrediction,
      "ATTACK"
    );
  }
);


/*
|--------------------------------------------------------------------------
| TEST 7
| Keycloak lockout
|--------------------------------------------------------------------------
*/

test(
  "lockout produces maximum HIGH risk",
  () => {

    const result =
      runIndependentDetector([
        loginError(1000),
        loginError(1100),
        loginError(1200),
        lockout(1300),
      ]);

    assert.equal(
      result.lockoutCount,
      1
    );

    assert.equal(
      result.riskScore,
      100
    );

    assert.equal(
      result.classification,
      "HIGH"
    );

    assert.equal(
      result.customPrediction,
      "ATTACK"
    );

    assert.equal(
      result.keycloakAssessment,
      "HIGH"
    );
  }
);


/*
|--------------------------------------------------------------------------
| TEST 8
| Confusion matrix
|--------------------------------------------------------------------------
*/

test(
  "confusion matrix works correctly",
  () => {

    assert.equal(
      classifyExperimentOutcome(
        "ATTACK",
        "ATTACK"
      ),
      "TRUE POSITIVE"
    );

    assert.equal(
      classifyExperimentOutcome(
        "NORMAL",
        "NORMAL"
      ),
      "TRUE NEGATIVE"
    );

    assert.equal(
      classifyExperimentOutcome(
        "NORMAL",
        "ATTACK"
      ),
      "FALSE POSITIVE"
    );

    assert.equal(
      classifyExperimentOutcome(
        "ATTACK",
        "NORMAL"
      ),
      "FALSE NEGATIVE"
    );
  }
);