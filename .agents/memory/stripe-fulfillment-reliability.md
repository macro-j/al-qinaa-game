---
name: Stripe fulfillment reliability (dev/test)
description: Why webhook-only fulfillment is fragile on Replit dev domains and the verify-on-return pattern that fixes it.
---

Relying ONLY on the async Stripe webhook for fulfillment is fragile in dev/test:
if the dev repl is asleep (or the test ran on the published app while the webhook
still points at the dev domain), Stripe cannot deliver `checkout.session.completed`
and the event sits with `pending_webhooks: 1` — entitlements never unlock.

**Why:** Stripe delivers webhooks to a fixed endpoint URL. A `*.worf.replit.dev`
dev domain is only reachable while the workspace is running, so delivery silently
fails/retries and the user sees no unlock on return.

**How to apply — belt-and-suspenders:**
- Keep the webhook as the async path (signature-verified, raw body before
  `express.json()`).
- ALSO add a synchronous verify-on-return endpoint. Put `session_id={CHECKOUT_SESSION_ID}`
  in `success_url`; on return the client POSTs the `session_id` + the user's Bearer
  token; the server retrieves the session from Stripe, confirms `payment_status==="paid"`
  AND that the session owner (`metadata.supabase_user_id` / `client_reference_id`)
  equals the token user (reject mismatch with 403), then calls the idempotent grant.
- The grant RPC must be idempotent so webhook + verify can both run safely.
- Diagnose delivery via Stripe API: a paid `checkout/sessions` entry plus an event
  with `pending_webhooks: 1` = registered-but-undelivered, not a code bug.
- Production needs its OWN webhook endpoint pointing at the prod domain.
