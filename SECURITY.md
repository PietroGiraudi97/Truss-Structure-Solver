# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅         |

## Reporting a vulnerability

This is a **client-side, offline** application — it runs entirely in your browser and makes no network requests (except the optional KaTeX CDN in `docs.html`). There is no server, no database, and no user data is collected or transmitted.

If you still find a security issue, please **do not open a public issue**. Instead, report it privately by opening a GitHub issue with the `security` label, or contact the maintainer directly. Please include:

- A description of the issue and its impact.
- Steps to reproduce.
- Any relevant files or code.

We aim to respond within 5 business days.

## Scope

The app loads no external code at runtime in `index.html` (all scripts are local). The only external dependency is the KaTeX CDN used by `docs.html` for math rendering, which falls back to raw text if offline. If you run the app from an untrusted origin, be aware that any local file you open is subject to your browser's file-access rules.
