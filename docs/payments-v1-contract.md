# Payments V1 Product Contract

## Identity

Payments is ExSol's tenant-scoped record of money requested, attempted, received, refunded, and
still owed. It is not a second booking engine, POS, fulfilment system, or accounting ledger.

Booking owns appointments, capacity, and appointment lifecycle. POS owns sales, fulfilment, and
inventory timing. Payments owns payment evidence and tells those source modules only the verified
payment outcome they need.

The existing `payments` registry key and the `saloon-booking` product key remain unchanged. They
are persisted platform compatibility keys, not client-facing product copy.

## V1 outcome

An enabled workspace can:

1. Record an authorized staff cash receipt against a Booking visit.
2. Create a Razorpay **Test-mode** checkout for a Booking deposit or full-upfront visit.
3. Verify a signed Razorpay webhook, deduplicate it, check its amount and currency, and create
   immutable payment evidence.
4. See what was requested, paid, refunded, failed, expired, or needs staff reconciliation.
5. Reuse the same payment core for a POS/storefront sale after the Booking flow is reliable.

No real money may move in V1 development. Test-mode credentials are an integration enabler, not a
production-payment launch decision.

## Proposed V1 operating decisions — confirmation gate

- **Merchant model (recommended):** each workspace connects its own Razorpay account. Funds settle directly to
  that workspace. ExSol does not custody funds, distribute payouts, or take marketplace commission.
- **Currency (recommended):** INR only. All monetary values are integer paise plus an explicit `INR` currency
  value; browser code must not use floating-point arithmetic for money.
- **Payment methods (recommended):** staff-recorded cash and Razorpay-hosted online collection. Card, UPI, and
  other methods offered inside Razorpay Checkout remain Razorpay's concern.
- **First online source (recommended):** Booking deposit/full-upfront visits. POS/storefront online collection
  comes only after the shared core passes the Booking test matrix.
- **Truth source (required):** an authorized cash receipt or a verified provider event is authoritative. A
  browser callback is only a customer-experience hint and may never mark an item paid.
- **Late events (recommended):** a payment event received after a Booking hold has expired opens a reconciliation
  case. It never silently reopens or re-confirms a potentially conflicting slot.
- **Refunds (recommended):** not part of the first capture milestone. The design must retain enough evidence to
  support provider and cash refunds next, without altering original transactions.

## The payment model

A **payment request** is one exact obligation: for example, a `booking_visit` deposit of ₹500.
It stores the tenant, source identifier, purpose, server-computed amount, currency, expiry, and a
snapshot of the source information used to calculate it.

A **payment attempt** is one collection try. An online attempt receives one dedicated Razorpay
order ID. A retry must use the existing valid attempt or create a clearly separate attempt; it must
never create two untracked orders for the same customer action.

A **payment transaction** is immutable financial evidence: `cash_received`, `provider_captured`,
`provider_failed`, `provider_refunded`, or a future authorised adjustment. It carries a safe
reference, actor/provider identity, amount, currency, and time.

A **payment allocation** applies part of one successful transaction to one request. This keeps an
appointment's deposit, balance, partial payment, and later refund explainable without changing the
original transaction.

## V1 Booking contract

Booking creates a pending payment-required visit using its existing reservation/policy rules. It
passes Payments a tenant-scoped visit ID, purpose (`deposit` or `full_upfront`), amount snapshot,
currency, expiry and customer-safe display information.

Payments returns a request/attempt identifier and, for an online request, checkout-safe data only.
The Razorpay Key ID may be returned only for that Checkout invocation. API secrets, webhook
secrets, encrypted columns, provider payloads and internal tenant configuration never reach the
browser.

When an allocation satisfies the request, Payments writes the transaction/allocation first, then
emits a narrow source outcome such as `payment_satisfied`. Booking decides whether its own policy
changes `pending` to `confirmed`. A pay-at-venue visit remains allowed to be confirmed while its
payment remains cash pending.

## Razorpay Test-mode handling

The available downloaded CSV contains a Test-mode Key ID and Key Secret. The values must never be
committed, copied into a source file, test fixture, screenshot, browser bundle, roadmap, or audit
detail. They must be placed only in an ignored local/staging secret store when the test integration
is implemented.

The API Key Secret is not a webhook secret. Before webhook testing, create a separate Test-mode
webhook secret in Razorpay Dashboard and configure the test endpoint on a publicly reachable
staging URL. Razorpay cannot deliver server webhooks directly to localhost. Test and Live keys,
webhook secrets, endpoint URLs, and provider connections are separate records/configurations.

## Required invariants

- Every request, attempt, transaction, allocation, webhook event, and reconciliation case is
  scoped to one tenant.
- A successful transaction cannot be deleted or edited. Corrections use an explicit compensating
  transaction, void state, or refund.
- A request cannot be allocated above its requested amount. A refund cannot exceed captured amount
  less prior completed/pending refunds.
- Provider event ID is unique. Provider payment/refund/order identifiers are unique in their correct
  scope. Duplicate delivery/retry is a no-op, not a duplicate charge or receipt.
- The provider webhook reads the raw body and verifies its HMAC in constant time before parsing.
- The webhook checks provider amount and currency against the stored request/attempt snapshot.
- Every staff cash, refund, configuration, override, and reconciliation action has an audit record
  without secret values.
- Public failures are generic and do not reveal another tenant's sale, booking, or payment state.

## Explicit non-goals

- Live Razorpay credentials or real customer collection.
- Stored cards, subscriptions, payment links, tips, instalments, wallets, multi-currency, foreign
  exchange, marketplace commission, payout distribution, or chargebacks.
- Replacing Booking's appointment lifecycle, POS's sale FSM, Orders' customer-service workflow, or
  Finance's accounting policy.
- Using `sales.payment_ref` as a Razorpay order or payment identifier; it remains an existing
  idempotency seam until a separately reviewed migration replaces it.

## Engineering gates

No payment migration is created until the human coordinator allocates its number. The migration
must be forward-only, one SQL statement per line, and use the shared `set_updated_at` trigger where
appropriate.

No online endpoint or feature flag is enabled until all of the following are true:

1. Payments has its manifest/navigation/authz/RouteMount/shared-layer/CSS module shape.
2. Cash receipts and allocation invariants pass against the persistent development database.
3. Provider credentials are encrypted at rest and write-only at the API boundary.
4. Razorpay Test-mode order creation, raw signed webhook verification, duplicate event handling,
   amount mismatch, late event, and provider failure tests pass.
5. A real browser verifies the test Checkout and a publicly reachable staging endpoint receives
   Test-mode webhook delivery.
6. `npm run typecheck`, the full `npm test` suite, and `npm run docs:reference` are green.

Until those gates pass, `src/modules/booking/config.ts` keeps
`ONLINE_PAYMENTS_ENABLED = false`, and the legacy Booking Razorpay webhook remains a disabled
reference seam rather than a production payment receiver.
