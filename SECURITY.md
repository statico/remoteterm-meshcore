# Security Policy

## Supported versions

We fix security problems only in the latest release. Before you report a problem, make sure that it occurs on the latest release.

## Report a vulnerability

Do not open a public issue for a security problem.

1. Go to the [Security tab](https://github.com/statico/remoteterm-meshcore/security) of this repository.
2. Click **Report a vulnerability**.
3. Give the version, the steps to reproduce the problem, and the result that you saw.

We reply within 7 days. When a fix is ready, we publish it in a release and give you credit in the changelog, unless you ask us not to.

## Out of scope

RemoteTerm is made for a network that you trust. The items that follow are deliberate design choices, not vulnerabilities:

- Anyone who can open the app can run Python code on the server through the bots. To stop this, set `MESHCORE_DISABLE_BOTS=true`.
- The app has no login by default. To add one, set HTTP Basic auth or use a reverse proxy.
- The CORS policy accepts all origins.
- An attacker who can open the app can read your messages and control your radio.

The "Before you start" section of the [README](README.md) tells you how to limit access. A report about one of these items is in scope only if it bypasses Basic auth or `MESHCORE_DISABLE_BOTS`.

Problems in the MeshCore firmware or protocol belong to the [MeshCore project](https://github.com/meshcore-dev/MeshCore).
