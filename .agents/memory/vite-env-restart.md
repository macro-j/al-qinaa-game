---
name: Vite env vars need workflow restart
description: Why a newly-set VITE_* env var shows up as undefined until the dev workflow restarts.
---

# Vite env vars need a workflow restart

Vite only exposes `VITE_*` env vars that are present in the process environment
**at the moment the dev server starts**. If you set a `VITE_*` var (e.g. via the
environment-secrets flow) while the dev workflow is already running, the running
server still sees it as `undefined` and client code throws a "config missing"
error.

**Fix:** restart the artifact's workflow after setting any `VITE_*` var so Vite
re-reads the environment. Don't waste time debugging the client code — restart
first, then re-check.
