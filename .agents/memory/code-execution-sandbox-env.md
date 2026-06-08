---
name: code_execution sandbox environment
description: What process.env does and does not contain inside the code_execution (JS notebook) sandbox.
---

The `code_execution` JS sandbox does **not** expose the project's secrets or
Replit runtime variables via `process.env`. Reads like
`process.env.SUPABASE_SERVICE_ROLE_KEY` or `process.env.REPLIT_DOMAINS` come back
`undefined` and throw `Cannot read properties of undefined`.

**Why:** secrets are deliberately redacted from the sandbox; runtime-managed vars
aren't injected there either.

**How to apply:**
- For credentials of a connected integration, use `listConnections('<name>')` and
  read `conns[0].settings.*` — that DOES work in the sandbox.
- For Replit runtime values (e.g. `REPLIT_DOMAINS`) or arbitrary secrets, read them
  in a `bash` step (`echo "$REPLIT_DOMAINS"`) and paste the literal into the
  sandbox code. Never print secret values.
