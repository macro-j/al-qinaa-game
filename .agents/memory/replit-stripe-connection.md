---
name: Replit Stripe connection shape
description: Field names and gaps in the Replit-managed Stripe connection, and how to do webhooks.
---

The Replit Stripe connection (`listConnections('stripe')[0].settings`) exposes:
`account_id, secret, publishable, mcp, claim_url`.

- Use `settings.secret` for the Stripe SDK secret key. The field is **`secret`**,
  not `secret_key` (the generic connector template uses `secret_key`). Read both
  defensively: `settings.secret ?? settings.secret_key`.
- There is **no** `webhook_secret` in the connection. Stripe webhook signature
  verification therefore requires you to create the webhook endpoint yourself
  (Stripe REST `POST /v1/webhook_endpoints`) and persist the returned `whsec_...`
  as `STRIPE_WEBHOOK_SECRET` via `setEnvVars({environment:'shared'})`.

**Why:** without a managed webhook secret, secure (signature-verified) fulfillment
needs a self-created endpoint + stored signing secret.

**How to apply (test mode):**
- Webhook URL must be the public domain + path, e.g.
  `https://<REPLIT_DOMAINS[0]>/api/stripe/webhook`. The dev `*.worf.replit.dev`
  domain is publicly reachable by Stripe while the repl runs.
- Webhook route MUST be registered before `express.json()` with
  `express.raw({type:'application/json'})`, then verify via
  `stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET)`.
- **Production needs its own webhook endpoint** pointing at the prod domain — the
  dev endpoint won't fire for the deployed app.
