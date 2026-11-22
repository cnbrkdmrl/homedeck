# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private reporting: go to the repository's **Security** tab → **Report a vulnerability**. Include what you found, how to reproduce it, and the version or commit. You can expect a first reply within a few days.

## Supported versions

Only the latest release on `main` receives fixes.

## Scope and threat model

HomeDeck is designed to run on a **trusted LAN or VPN**, not on the open internet.

- The viewer and ingest allow-lists (`VIEWER_CIDRS`, `INGEST_CIDRS`) are the main access control; requests from other addresses get `403`. `X-Forwarded-For` is deliberately not trusted.
- Agents and the webhook authenticate with per-machine bearer tokens.
- The layout-editor PIN (`EDIT_PIN`) is weak protection by design. With no PIN set, editing is disabled.
- `docker.sock` is only reachable through a read-only socket proxy.
- If you expose the hub beyond your LAN, set `ACCESS_TOKEN` and put it behind a reverse proxy with TLS.

Reports that need an attacker already inside the allow-listed network or holding a valid token are still welcome, but are treated as lower severity.

## Handling secrets

Never commit `.env`, tokens or Home Assistant / Gitea credentials. If you accidentally published one, revoke it first, then clean up.
