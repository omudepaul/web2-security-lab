<<<<<<< HEAD
\# Web2 Security Research Lab



This project is an experimental OAuth 2.0 / OpenID Connect security environment built using Keycloak and Node.js.



\## Project Purpose



The goal of this project is to study authentication security using an open-source Web2 security platform that can be fully compiled, deployed, configured, and tested.



The environment currently demonstrates:



\- OAuth 2.0 / OpenID Connect authentication

\- Authorization Code Flow with PKCE

\- Keycloak user authentication

\- Application security event logging

\- Keycloak event monitoring

\- Failed-login detection

\- Brute-force attack detection

\- Temporary account lockout

\- Security risk classification

\- Security alert dashboard



\## Architecture



User



↓



Node.js Research Application



↓



OAuth 2.0 / OpenID Connect



↓



Keycloak



↓



Authentication and Security Events



↓



Keycloak Admin REST API



↓



Security Monitor Service Account



↓



Security Detection Dashboard



\## Components



\### Keycloak



Keycloak is used as the open-source Identity and Access Management platform.



Keycloak was compiled from source and deployed locally.



Realm:



web2-security-lab



\### Research Application



The Node.js research application runs at:



http://localhost:3000



\### Keycloak Server



The locally compiled Keycloak server runs at:



http://localhost:8080



\## Security Experiment



The current experiment performs controlled failed-login testing against a local test account.



After repeated failed authentication attempts, Keycloak detects possible brute-force activity and temporarily locks the account.



The monitoring application retrieves Keycloak events through the Admin REST API and displays:



\- successful logins

\- failed logins

\- brute-force detections

\- temporary lockouts

\- source IP

\- target user

\- security risk level



\## Risk Classification



LOW:

Normal authentication activity.



MEDIUM:

Three or more failed login attempts.



HIGH:

Brute-force attack detection or temporary account lockout.



\## Environment Variables



Copy:



.env.example



to:



.env



and provide your own Keycloak service-account client secret.



Never commit the `.env` file.



\## Current Status



The project currently supports a working local live demonstration of OAuth/OIDC authentication, security-event monitoring, brute-force detection, and automatic risk classification.

=======
# web2-security-lab
OAuth 2.0 and Keycloak security monitoring lab with brute-force attack detection
>>>>>>> 033c184268ec401a58999187c94dc149374b6f78
