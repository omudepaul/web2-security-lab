# Web2 Security Lab

A research-oriented Web2 security monitoring laboratory built with **OAuth 2.0 / OpenID Connect (OIDC)**, **Keycloak**, **Node.js**, and **Express**.

The project demonstrates authentication, security-event monitoring, controlled brute-force experiments, an independent detection engine, and quantitative detector evaluation.

> **Scope:** This repository is intended for controlled local research and educational testing only.

## Project Objectives

The project is designed to:

- deploy and control an open-source identity and access management platform;
- implement OAuth 2.0 / OIDC authentication with Keycloak;
- collect and analyze Keycloak authentication security events;
- detect suspicious authentication behavior independently of Keycloak's own classification;
- run isolated ATTACK and NORMAL experiments;
- compare custom detector predictions with Keycloak observations; and
- evaluate detector performance using a confusion matrix and standard classification metrics.

## Architecture

```text
User / Browser
      |
      v
Node.js + Express Research Application
      |
      | OAuth 2.0 / OIDC + PKCE
      v
Keycloak Identity Provider
      |
      | Admin API / Security Events
      v
Independent Detection Engine
      |
      v
Controlled Experiment Framework
      |
      v
Evaluation Dashboard