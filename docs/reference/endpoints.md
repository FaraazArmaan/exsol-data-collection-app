<!--
  GENERATED FILE — do not hand-edit.
  Regenerate with: npm run docs:reference   (scripts/generate-reference.ts)
  Derived from: netlify/functions/*.ts (config exports, authz imports, permission-key literals)
-->

# API endpoints

342 functions. "name-routed" = no `config.path`; reachable as `/api/<file>` via the
netlify.toml `/api/* -> /.netlify/functions/:splat` redirect (iron rule 5: the FILE NAME is the route).

Auth tiers: **admin** (`requireAdmin`, AMS console) · **bucket-user** (workspace user via
`requireBucketUser`/`authenticateForPermission`/module `_<key>-authz`) · **service** (narrow server-to-server secret) · **public** (no session).

## ams (platform)

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| admin-client-products.ts | `/api/admin-client-products (name-routed)` | any | admin | — |
| admin-impersonate.ts | `/api/admin-impersonate (name-routed)` | any | public | — |
| admin-impersonation-exit.ts | `/api/admin-impersonation-exit (name-routed)` | any | public | — |
| admin-self.ts | `/api/admin-self (name-routed)` | any | admin | — |
| admin-team-detail.ts | `/api/admin-team-detail (name-routed)` | any | public | — |
| admin-team.ts | `/api/admin-team (name-routed)` | any | admin | — |
| audit-log.ts | `/api/audit-log (name-routed)` | any | admin | — |
| client-cardinality.ts | `/api/client-cardinality (name-routed)` | any | public | — |
| client-levels-detail.ts | `/api/client-levels-detail (name-routed)` | any | public | — |
| client-levels-permissions.ts | `/api/client-levels-permissions (name-routed)` | any | bucket-user | `_platform.users.view` |
| client-levels.ts | `/api/client-levels (name-routed)` | any | public | — |
| client-roles-detail.ts | `/api/client-roles-detail (name-routed)` | any | public | — |
| client-roles.ts | `/api/client-roles (name-routed)` | any | public | — |
| client-settings-brand-image.ts | `/api/client-settings/brand-image` | POST | bucket-user | `_platform.settings.edit` |
| client-settings-brand.ts | `/api/client-settings/brand` | PATCH | bucket-user | `_platform.settings.edit` |
| client-settings-storefront.ts | `/api/client-settings/storefront` | any | bucket-user | `_platform.settings.edit` |
| client-structure.ts | `/api/client-structure (name-routed)` | any | bucket-user | `_platform.users.view` |
| clients-detail.ts | `/api/clients-detail (name-routed)` | any | admin | — |
| clients.ts | `/api/clients (name-routed)` | any | admin | — |
| onboard-client-bulk.ts | `/api/onboard-client-bulk (name-routed)` | any | admin | — |
| onboard-client.ts | `/api/onboard-client (name-routed)` | any | admin | — |
| user-node-credential.ts | `/api/user-node-credential (name-routed)` | any | bucket-user | `_platform.users.edit` |
| user-nodes-bulk-role-change.ts | `/api/user-nodes-bulk-role-change (name-routed)` | any | bucket-user | `_platform.users.edit` |
| user-nodes-bulk.ts | `/api/user-nodes-bulk (name-routed)` | any | bucket-user | `_platform.users.create` |
| user-nodes-detail.ts | `/api/user-nodes-detail (name-routed)` | any | bucket-user | `_platform.users.delete`, `_platform.users.edit`, `_platform.users.view` |
| user-nodes-move.ts | `/api/user-nodes-move (name-routed)` | any | bucket-user | `_platform.users.edit` |
| user-nodes-role-change.ts | `/api/user-nodes-role-change (name-routed)` | any | bucket-user | `_platform.users.edit` |
| user-nodes.ts | `/api/user-nodes (name-routed)` | any | bucket-user | `_platform.users.create`, `_platform.users.view` |
| workspace-export.ts | `/api/workspace-export (name-routed)` | any | bucket-user | `_platform.workspace.view` |

## analytics

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| analytics-bookings.ts | `/api/analytics-bookings` | GET | bucket-user | — |
| analytics-catalog.ts | `/api/analytics-catalog` | GET | bucket-user | — |
| analytics-customers.ts | `/api/analytics-customers` | GET | bucket-user | — |
| analytics-overview.ts | `/api/analytics-overview` | GET | bucket-user | — |
| analytics-sales-export.ts | `/api/analytics-sales-export` | GET | bucket-user | — |
| analytics-sales.ts | `/api/analytics-sales` | GET | bucket-user | — |
| analytics-team.ts | `/api/analytics-team` | GET | bucket-user | — |

## booking

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| booking-detail.ts | `/api/booking/detail/:id` | GET, PATCH | bucket-user | `booking.customers.edit`, `booking.customers.view` |
| booking-list.ts | `/api/booking/list` | GET | bucket-user | `booking.customers.view` |
| booking-manual-create.ts | `/api/booking/manual-create` | POST | bucket-user | `booking.customers.create` |
| booking-pending-cleanup.ts | `/api/booking-pending-cleanup (name-routed)` | any | public | — |
| booking-policy.ts | `/api/booking/policy` | GET, PUT | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-publication.ts | `/api/booking/publication` | GET, PUT | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-razorpay-webhook.ts | `/api/booking-public/razorpay-webhook` | POST | public | — |
| booking-resource-detail.ts | `/api/booking/resource-detail/:id` | GET, PATCH, DELETE | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-resource-time-off.ts | `/api/booking/resource-time-off` | GET, POST, DELETE | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-resources.ts | `/api/booking/resources` | GET, POST | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-service-detail.ts | `/api/booking/service-detail/:id` | GET, PATCH, DELETE | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-services.ts | `/api/booking/services` | GET, POST | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-settings.ts | `/api/booking/settings` | GET, PUT | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-setup.ts | `/api/booking/setup` | GET, PUT | bucket-user | `booking.employees.edit`, `booking.employees.view` |

## booking (public)

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| booking-public-availability.ts | `/api/booking-public/:slug/availability` | GET | public | — |
| booking-public-create.ts | `/api/booking-public/:slug/create` | POST | public | — |
| booking-public-manage.ts | `/api/booking-public/manage/:token` | GET, POST | public | — |
| booking-public-resources.ts | `/api/booking-public/:slug/resources` | GET | public | — |
| booking-public-services.ts | `/api/booking-public/:slug/services` | GET | public | — |

## catalog (public)

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| pub-catalog.ts | `/api/public/catalog/:slug` | GET | public | — |

## crm

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| crm-customer-detail.ts | `/api/crm/customers/:id` | GET | bucket-user | `crm.customers.view` |
| crm-customers-list.ts | `/api/crm/customers` | GET | bucket-user | `crm.customers.view` |
| crm-dashboard.ts | `/api/crm/dashboard` | GET | bucket-user | `crm.customers.view` |
| crm-lead-action.ts | `/api/crm/lead-action/:id` | POST | bucket-user | `crm.customers.create`, `crm.customers.edit` |
| crm-lead-submit.ts | `/api/crm/lead-submit` | POST | public | — |
| crm-leads-list.ts | `/api/crm/leads` | GET | bucket-user | `crm.customers.view` |
| crm-note-detail.ts | `/api/crm/notes/:id` | PATCH, DELETE | bucket-user | `crm.customers.delete`, `crm.customers.edit` |
| crm-notes.ts | `/api/crm/notes` | POST | bucket-user | `crm.customers.create` |
| crm-refresh.ts | `/api/crm/refresh` | POST | bucket-user | `crm.customers.view` |
| crm-repeat-cart.ts | `/api/crm/repeat-cart/:id` | GET | bucket-user | `crm.customers.view` |
| crm-social.ts | `/api/crm/social` | GET, POST | bucket-user | `crm.customers.edit`, `crm.customers.view` |
| crm-timeline.ts | `/api/crm/timeline/:id` | GET | bucket-user | `crm.customers.view` |

## data-collection

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| onboard-generate.ts | `/api/onboard-generate` | POST | bucket-user | `data-collection.products.create` |

## email

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| email-outbox.ts | `/api/email/outbox` | GET | bucket-user | `email.customers.view` |

## files (platform)

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| files-bulk.ts | `/api/files-bulk (name-routed)` | any | bucket-user | `_platform.files.delete`, `_platform.files.edit` |
| files-detail.ts | `/api/files-detail (name-routed)` | any | bucket-user | `_platform.files.delete`, `_platform.files.edit`, `_platform.files.view` |
| files-download-url.ts | `/api/files-download-url (name-routed)` | any | bucket-user | `_platform.files.view` |
| files-quota.ts | `/api/files-quota (name-routed)` | any | bucket-user | `_platform.files.view` |
| files-thumbnail.ts | `/api/files-thumbnail (name-routed)` | any | bucket-user | `_platform.files.view` |
| files-upload-url.ts | `/api/files-upload-url (name-routed)` | any | bucket-user | `_platform.files.create` |
| files-upload.ts | `/api/files-upload (name-routed)` | any | bucket-user | `_platform.files.create` |
| files.ts | `/api/files (name-routed)` | any | bucket-user | `_platform.files.create`, `_platform.files.view` |

## finance

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| finance-ai-insights.ts | `/api/finance/ai-insights` | GET, POST | bucket-user | `finance.business.edit`, `finance.business.view` |
| finance-approval-decide.ts | `/api/finance/approval-decide/:id` | POST | bucket-user | `finance.business.edit` |
| finance-approvals.ts | `/api/finance/approvals` | GET | bucket-user | `finance.business.view` |
| finance-cashflow.ts | `/api/finance/cashflow` | GET | bucket-user | `finance.business.view` |
| finance-expense-detail.ts | `/api/finance/expense-detail/:id` | PATCH, DELETE | bucket-user | `finance.business.delete`, `finance.business.edit` |
| finance-expenses.ts | `/api/finance/expenses` | GET, POST | bucket-user | `finance.business.create`, `finance.business.view` |
| finance-ocr-receipt.ts | `/api/finance/ocr-receipt` | POST | bucket-user | `finance.business.create` |
| finance-recurring-cron.ts | `/api/finance-recurring-cron (name-routed)` | any | public | — |
| finance-recurring-detail.ts | `/api/finance/recurring-detail/:id` | PATCH, DELETE | bucket-user | `finance.business.delete`, `finance.business.edit` |
| finance-recurring-run.ts | `/api/finance/recurring-run` | POST | bucket-user | `finance.business.create` |
| finance-recurring.ts | `/api/finance/recurring` | GET, POST | bucket-user | `finance.business.create`, `finance.business.view` |
| finance-settings.ts | `/api/finance/settings` | GET, PUT | bucket-user | `finance.business.edit`, `finance.business.view` |
| finance-summary.ts | `/api/finance/summary` | GET | bucket-user | `finance.business.view` |

## hr

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| hr-checklist-instance.ts | `/api/hr/checklist-instance` | any | bucket-user | `hr.employees.edit`, `hr.employees.view` |
| hr-checklist-instances.ts | `/api/hr/checklist-instances` | any | bucket-user | `hr.employees.create`, `hr.employees.view` |
| hr-checklist-templates.ts | `/api/hr/checklist-templates` | any | bucket-user | `hr.employees.edit`, `hr.employees.view` |
| hr-dashboard.ts | `/api/hr/dashboard` | GET | bucket-user | `hr.employees.view` |
| hr-org.ts | `/api/hr/org` | GET | bucket-user | `hr.employees.view` |

## inventory

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| inventory-adjust.ts | `/api/inventory/adjust` | POST | bucket-user | `inventory.products.edit` |
| inventory-by-location.ts | `/api/inventory/by-location` | GET | bucket-user | `inventory.products.view` |
| inventory-dashboard.ts | `/api/inventory/dashboard` | GET | bucket-user | `inventory.products.view` |
| inventory-labels.ts | `/api/inventory/labels` | GET | bucket-user | `inventory.products.view` |
| inventory-lifecycle.ts | `/api/inventory/lifecycle` | POST | bucket-user | `inventory.products.edit` |
| inventory-list.ts | `/api/inventory/list` | GET | bucket-user | `inventory.products.view` |
| inventory-movements.ts | `/api/inventory/movements` | GET | bucket-user | `inventory.products.view` |
| inventory-product-locations.ts | `/api/inventory/product-locations` | GET | bucket-user | `inventory.products.view` |
| inventory-returns.ts | `/api/inventory/returns` | GET, POST | bucket-user | `inventory.products.edit`, `inventory.products.view` |

## login (admin)

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| auth-config.ts | `/api/auth-config (name-routed)` | any | public | — |
| auth-google.ts | `/api/auth-google (name-routed)` | any | public | — |
| auth-login.ts | `/api/auth-login (name-routed)` | any | public | — |
| auth-logout-all.ts | `/api/auth-logout-all (name-routed)` | any | admin | — |
| auth-logout.ts | `/api/auth-logout (name-routed)` | any | public | — |
| auth-me.ts | `/api/auth-me (name-routed)` | any | admin | — |
| auth-mfa-challenge.ts | `/api/auth-mfa-challenge (name-routed)` | any | public | — |
| auth-mfa-confirm.ts | `/api/auth-mfa-confirm (name-routed)` | any | admin | — |
| auth-mfa-disable.ts | `/api/auth-mfa-disable (name-routed)` | any | admin | — |
| auth-mfa-enroll.ts | `/api/auth-mfa-enroll (name-routed)` | any | admin | — |
| auth-mfa-status.ts | `/api/auth-mfa-status (name-routed)` | any | admin | — |
| forgot-password.ts | `/api/forgot-password (name-routed)` | any | public | — |
| login.ts | `/api/login (name-routed)` | any | public | — |

## login (user portal)

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| u-change-password.ts | `/api/u-change-password (name-routed)` | any | bucket-user | — |
| u-client-by-slug.ts | `/api/u-client-by-slug (name-routed)` | any | public | — |
| u-link-google.ts | `/api/u-link-google (name-routed)` | any | bucket-user | — |
| u-login.ts | `/api/u-login (name-routed)` | any | public | — |
| u-logout-all.ts | `/api/u-logout-all (name-routed)` | any | bucket-user | — |
| u-logout.ts | `/api/u-logout (name-routed)` | any | public | — |
| u-me.ts | `/api/u-me (name-routed)` | any | bucket-user | — |
| u-unlink-google.ts | `/api/u-unlink-google (name-routed)` | any | bucket-user | — |

## manufacturing

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| manufacturing-bom-cost.ts | `/api/manufacturing/bom-cost/:id` | GET | bucket-user | `manufacturing.products.view` |
| manufacturing-bom-detail.ts | `/api/manufacturing/bom-detail/:id` | GET, PUT, DELETE | bucket-user | `manufacturing.products.delete`, `manufacturing.products.edit`, `manufacturing.products.view` |
| manufacturing-boms.ts | `/api/manufacturing/boms` | GET, POST | bucket-user | `manufacturing.products.create`, `manufacturing.products.view` |
| manufacturing-capacity.ts | `/api/manufacturing/capacity` | GET | bucket-user | `manufacturing.business.view` |
| manufacturing-costs.ts | `/api/manufacturing/costs` | GET, POST | bucket-user | `manufacturing.products.edit`, `manufacturing.products.view` |
| manufacturing-kanban.ts | `/api/manufacturing/kanban` | GET | bucket-user | `manufacturing.products.view` |
| manufacturing-lots.ts | `/api/manufacturing/lots` | GET, POST | bucket-user | `manufacturing.products.edit`, `manufacturing.products.view` |
| manufacturing-maintenance.ts | `/api/manufacturing/maintenance` | GET, POST | bucket-user | `manufacturing.business.create`, `manufacturing.business.view` |
| manufacturing-order-advance.ts | `/api/manufacturing/order-advance/:id` | POST | bucket-user | `manufacturing.products.edit` |
| manufacturing-order-board.ts | `/api/manufacturing/order-board` | POST | bucket-user | `manufacturing.products.edit` |
| manufacturing-order-resource.ts | `/api/manufacturing/order-resource` | POST | bucket-user | `manufacturing.products.edit` |
| manufacturing-orders.ts | `/api/manufacturing/orders` | GET, POST | bucket-user | `manufacturing.products.create`, `manufacturing.products.view` |
| manufacturing-qc-result.ts | `/api/manufacturing/qc-result` | POST | bucket-user | `manufacturing.products.edit` |
| manufacturing-qc.ts | `/api/manufacturing/qc` | GET, POST | bucket-user | `manufacturing.products.edit`, `manufacturing.products.view` |
| manufacturing-resources.ts | `/api/manufacturing/resources` | GET, POST | bucket-user | `manufacturing.business.create`, `manufacturing.business.view` |
| manufacturing-scrap.ts | `/api/manufacturing/scrap` | GET, POST | bucket-user | `manufacturing.products.edit`, `manufacturing.products.view` |

## marketing

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| marketing-audience-count.ts | `/api/marketing/audience-count` | GET | bucket-user | `marketing.customers.view` |
| marketing-campaign-ab.ts | `/api/marketing/campaigns/:id/ab` | GET | bucket-user | `marketing.customers.view` |
| marketing-campaign-create.ts | `/api/marketing/campaigns` | POST | bucket-user | `marketing.customers.create` |
| marketing-campaign-detail.ts | `/api/marketing/campaigns/:id` | GET | bucket-user | `marketing.customers.view` |
| marketing-campaign-send.ts | `/api/marketing/send` | POST | bucket-user | `marketing.customers.edit` |
| marketing-campaigns-list.ts | `/api/marketing/campaigns` | GET | bucket-user | `marketing.customers.view` |
| marketing-gdpr-consent.ts | `/api/marketing/gdpr/consent` | any | bucket-user | `marketing.customers.edit`, `marketing.customers.view` |
| marketing-gdpr-erase.ts | `/api/marketing/gdpr/erase` | POST | bucket-user | `marketing.customers.delete` |
| marketing-gdpr-export.ts | `/api/marketing/gdpr/export` | GET | bucket-user | `marketing.customers.view` |
| marketing-public-track.ts | `/api/marketing/track/:kind` | GET | public | — |
| marketing-roi.ts | `/api/marketing/roi` | GET | bucket-user | `marketing.customers.view` |
| marketing-social-dispatch.ts | `/api/marketing-social-dispatch (name-routed)` | any | public | — |
| marketing-social-posts.ts | `/api/marketing/social-posts` | any | bucket-user | `marketing.customers.create`, `marketing.customers.edit`, `marketing.customers.view` |
| marketing-webhook-receive.ts | `/api/marketing/webhook/:token` | POST | public | — |
| marketing-webhook-triggers.ts | `/api/marketing/webhook-triggers` | any | bucket-user | `marketing.customers.edit` |
| marketing-webhooks.ts | `/api/marketing/webhooks` | any | bucket-user | `marketing.customers.edit`, `marketing.customers.view` |

## orders

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| orders-backorder-fulfill.ts | `/api/orders/backorder-fulfill/:id` | POST | bucket-user | `orders.business.edit` |
| orders-backorders.ts | `/api/orders/backorders` | GET, POST | bucket-user | `orders.business.create`, `orders.business.view` |
| orders-cancel-remaining.ts | `/api/orders/cancel-remaining/:saleId` | POST | bucket-user | `orders.business.edit` |
| orders-dashboard.ts | `/api/orders/dashboard` | GET | bucket-user | `orders.business.view` |
| orders-fulfillment-advance.ts | `/api/orders/fulfillment-advance/:id` | POST | bucket-user | `orders.business.edit` |
| orders-fulfillments.ts | `/api/orders/fulfillments` | GET | bucket-user | `orders.business.view` |
| orders-merge.ts | `/api/orders/merge` | POST | bucket-user | `orders.business.edit` |
| orders-packing-slip.ts | `/api/orders/packing-slip/:id` | GET | bucket-user | `orders.business.view` |
| orders-pick-list.ts | `/api/orders/pick-list/:id` | GET | bucket-user | `orders.business.view` |
| orders-pickup-collect.ts | `/api/orders/pickups/:id/collect` | POST | bucket-user | `orders.business.edit` |
| orders-pickups.ts | `/api/orders/pickups` | GET, POST | bucket-user | `orders.business.create`, `orders.business.view` |
| orders-queue.ts | `/api/orders/queue` | GET | bucket-user | `orders.business.view` |
| orders-refund-advance.ts | `/api/orders/refund-advance/:id` | POST | bucket-user | `orders.business.edit` |
| orders-refunds.ts | `/api/orders/refunds` | GET, POST | bucket-user | `orders.business.create`, `orders.business.view` |
| orders-return-access.ts | `/api/orders/returns/access` | POST, DELETE | bucket-user | `orders.business.create` |
| orders-return-advance.ts | `/api/orders/returns/:id/advance` | POST | bucket-user | `orders.business.edit` |
| orders-return-receipt-link.ts | `/api/orders/returns/:id/receipt-link` | POST | bucket-user | `orders.business.edit` |
| orders-return-refund-request.ts | `/api/orders/returns/:id/refund-request` | POST | bucket-user | `orders.business.create` |
| orders-returns.ts | `/api/orders/returns` | GET, POST | bucket-user | `orders.business.create`, `orders.business.view` |
| orders-sale-lines.ts | `/api/orders/sale-lines/:saleId` | GET | bucket-user | `orders.business.view` |
| orders-shipment-detail.ts | `/api/orders/shipment-detail/:id` | GET, PUT | bucket-user | `orders.business.edit`, `orders.business.view` |
| orders-shipments.ts | `/api/orders/shipments` | GET, POST | bucket-user | `orders.business.create`, `orders.business.view` |
| orders-sla-targets.ts | `/api/orders/sla-targets` | GET, PUT | bucket-user | `orders.business.edit`, `orders.business.view` |
| orders-sla.ts | `/api/orders/sla` | GET | bucket-user | `orders.business.view` |
| orders-split.ts | `/api/orders/split/:saleId` | POST | bucket-user | `orders.business.edit` |

## payments

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| payments-cash-receipt.ts | `/api/payments/cash-receipts` | POST | bucket-user | `payments.customers.create` |
| payments-dashboard.ts | `/api/payments/dashboard` | GET | bucket-user | `payments.customers.view` |
| payments-orders-refund-submit.ts | `/api/payments/orders-refunds/:id/submit` | POST | bucket-user | `payments.customers.edit` |
| payments-provider-connection.ts | `/api/payments/provider-connection` | any | bucket-user | `payments.products.edit`, `payments.products.view` |

## platform

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| abandoned-cart-cron.ts | `/api/abandoned-cart-cron (name-routed)` | any | public | — |
| onboard-import.ts | `/api/onboard-import/:token` | POST | public | — |
| onboard-public.ts | `/api/onboard-public/:token` | GET | public | — |
| payments-razorpay-webhook.ts | `/api/payments/razorpay-webhook` | POST | public | — |
| sale-payment-expiry.ts | `/api/sale-payment-expiry (name-routed)` | any | public | — |
| u-credential-token.ts | `/api/u-credential-token (name-routed)` | any | public | — |
| webhook-example.ts | `/api/webhook-example` | POST | public | — |
| workspace-layouts.ts | `/api/workspace-layouts` | any | bucket-user | — |

## portfolio

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| brand-site.ts | `/api/brand-site` | any | bucket-user | `portfolio.business.edit`, `portfolio.business.view` |

## pos

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| pos-bundle-detail.ts | `/api/pos/bundles/:id` | any | bucket-user | `pos.sale.refund` |
| pos-bundles.ts | `/api/pos/bundles` | any | bucket-user | `pos.sale.refund` |
| pos-coupon-detail.ts | `/api/pos/coupons/:id` | any | bucket-user | `pos.sale.refund` |
| pos-coupons.ts | `/api/pos/coupons` | any | bucket-user | `pos.sale.refund` |
| pos-marketplace-feed.ts | `/api/pos/marketplace-feed` | any | bucket-user | `pos.sale.refund` |
| pos-menu.ts | `/api/pos/menu` | any | bucket-user | `pos.menu.view` |
| pos-review-detail.ts | `/api/pos/reviews/:id` | any | bucket-user | `pos.history.viewAll` |
| pos-reviews.ts | `/api/pos/reviews` | any | bucket-user | `pos.history.viewAll` |
| pos-sale-create.ts | `/api/pos/sales` | POST | bucket-user | `pos.sale.create`, `pos.sale.created` |
| pos-sale-detail.ts | `/api/pos/sales/:id` | any | bucket-user | `pos.history.view`, `pos.history.viewAll` |
| pos-sale-quote.ts | `/api/pos/sale-quote` | POST | bucket-user | `pos.sale.create` |
| pos-sale-state.ts | `/api/pos/sales/:id/state` | any | bucket-user | `pos.history.view`, `pos.sale.fulfill` |
| pos-sales-list.ts | `/api/pos/sales` | GET | bucket-user | `pos.history.view`, `pos.history.viewAll` |
| pos-storefront-cms.ts | `/api/pos/storefront-cms` | any | bucket-user | `pos.sale.refund` |
| pos-tax.ts | `/api/pos/tax` | any | bucket-user | `pos.sale.refund` |

## pos storefront (public)

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| pub-brand-image.ts | `/api/public/brand/:slug/image/*` | GET | public | — |
| pub-brand.ts | `/api/public/brand/:slug` | GET | public | — |
| pub-cart-save.ts | `/api/public/cart` | POST | public | — |
| pub-coupon-validate.ts | `/api/public/coupon-validate` | POST | public | — |
| pub-menu.ts | `/api/public/menu/:slug` | GET | public | — |
| pub-orders-returns.ts | `/api/public/returns` | GET, POST | public | — |
| pub-review-create.ts | `/api/public/reviews` | POST | public | — |
| pub-reviews.ts | `/api/public/reviews/:slug` | GET | public | — |
| pub-sale-create.ts | `/api/public/sales` | POST | public | `pos.sale.created` |
| pub-sale-detail.ts | `/api/public/sales/:saleUuid` | GET | public | — |
| pub-site-surfaces.ts | `/api/public/site-surfaces/:slug` | GET | public | — |
| pub-site.ts | `/api/public/site/:slug` | GET | public | — |
| pub-storefront-config.ts | `/api/public/config/:slug` | GET | public | — |

## procurement

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| procurement-grn.ts | `/api/procurement/grn` | GET, POST | bucket-user | `procurement.products.edit`, `procurement.products.view` |
| procurement-invoices.ts | `/api/procurement/invoices` | GET, POST | bucket-user | `procurement.products.edit`, `procurement.products.view` |
| procurement-match.ts | `/api/procurement/match` | GET, POST | bucket-user | `procurement.products.edit`, `procurement.products.view` |
| procurement-order-detail.ts | `/api/procurement/orders/:id` | GET | bucket-user | `procurement.products.view` |
| procurement-order-transition.ts | `/api/procurement/orders/:id/transition` | POST | bucket-user | `procurement.products.delete`, `procurement.products.edit` |
| procurement-orders.ts | `/api/procurement/orders` | GET, POST | bucket-user | `procurement.products.create`, `procurement.products.view` |
| procurement-prices.ts | `/api/procurement/prices` | GET, POST | bucket-user | `procurement.products.edit`, `procurement.products.view` |
| procurement-products.ts | `/api/procurement/products` | GET | bucket-user | `procurement.products.view` |
| procurement-settings.ts | `/api/procurement/settings` | GET, PATCH | bucket-user | `procurement.products.edit`, `procurement.products.view` |
| procurement-spend.ts | `/api/procurement/spend` | GET | bucket-user | `procurement.products.view` |
| procurement-supplier-contact-detail.ts | `/api/procurement/supplier-contacts/:id` | DELETE | bucket-user | `procurement.products.edit` |
| procurement-supplier-contacts.ts | `/api/procurement/supplier-contacts` | GET, POST | bucket-user | `procurement.products.edit`, `procurement.products.view` |
| procurement-supplier-detail.ts | `/api/procurement/suppliers/:id` | PATCH, DELETE | bucket-user | `procurement.products.delete`, `procurement.products.edit` |
| procurement-suppliers.ts | `/api/procurement/suppliers` | GET, POST | bucket-user | `procurement.products.create`, `procurement.products.view` |

## products

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| u-product-categories.ts | `/api/u-product-categories (name-routed)` | any | bucket-user | `products.products.create`, `products.products.delete`, `products.products.edit`, `products.products.view` |
| u-product-variants.ts | `/api/u-product-variants (name-routed)` | any | bucket-user | `products.products.create`, `products.products.edit`, `products.products.view` |
| u-products-bulk.ts | `/api/u-products-bulk (name-routed)` | any | bucket-user | `products.products.delete`, `products.products.edit` |
| u-products-detail.ts | `/api/u-products-detail (name-routed)` | any | bucket-user | `products.products.delete`, `products.products.edit`, `products.products.view` |
| u-products-export.ts | `/api/u-products-export (name-routed)` | any | bucket-user | `products.products.view` |
| u-products-image-thumb.ts | `/api/u-products-image-thumb (name-routed)` | any | bucket-user | `products.products.view` |
| u-products-image.ts | `/api/u-products-image (name-routed)` | any | bucket-user | `products.products.edit` |
| u-products-import.ts | `/api/u-products-import (name-routed)` | any | bucket-user | `products.products.create`, `products.products.edit` |
| u-products.ts | `/api/u-products (name-routed)` | any | bucket-user | `products.products.create`, `products.products.view` |

## supply-chain

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| supply-chain-brief.ts | `/api/supply-chain-brief` | GET | bucket-user | — |
| supply-chain-co2.ts | `/api/supply-chain-co2` | any | bucket-user | `supply-chain.products.edit` |
| supply-chain-drill.ts | `/api/supply-chain-drill` | GET | bucket-user | — |
| supply-chain-inventory.ts | `/api/supply-chain-inventory` | GET | bucket-user | — |
| supply-chain-manufacturing.ts | `/api/supply-chain-manufacturing` | GET | bucket-user | — |
| supply-chain-procurement.ts | `/api/supply-chain-procurement` | GET | bucket-user | — |
| supply-chain-risk.ts | `/api/supply-chain-risk` | GET | bucket-user | — |
| supply-chain-suppliers.ts | `/api/supply-chain-suppliers (name-routed)` | any | bucket-user | `supply-chain.products.create`, `supply-chain.products.delete` |

## warehouse

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| warehouse-ai-slotting-decide.ts | `/api/warehouse/ai-slotting-decide` | POST | bucket-user | `warehouse.products.edit` |
| warehouse-ai-slotting-generate.ts | `/api/warehouse/ai-slotting-generate` | POST | bucket-user | `warehouse.products.edit` |
| warehouse-ai-slotting.ts | `/api/warehouse/ai-slotting` | GET | bucket-user | `warehouse.products.view` |
| warehouse-asn-detail.ts | `/api/warehouse/asn-detail/:id` | GET | bucket-user | `warehouse.products.view` |
| warehouse-asn-receive.ts | `/api/warehouse/asn-receive` | POST | bucket-user | `warehouse.products.edit` |
| warehouse-asn.ts | `/api/warehouse/asn` | any | bucket-user | `warehouse.products.create`, `warehouse.products.view` |
| warehouse-execution-task-complete.ts | `/api/warehouse/execution-task-complete` | POST | bucket-user | `warehouse.products.edit` |
| warehouse-execution-tasks.ts | `/api/warehouse/execution-tasks` | GET, POST | bucket-user | `warehouse.products.view` |
| warehouse-location.ts | `/api/warehouse/location/:id` | any | bucket-user | `warehouse.business.delete`, `warehouse.business.edit` |
| warehouse-locations.ts | `/api/warehouse/locations` | any | bucket-user | `warehouse.business.create`, `warehouse.business.view` |
| warehouse-orders-execution-tasks.ts | `/api/internal/orders/warehouse-execution-tasks` | GET, POST | service | — |
| warehouse-products.ts | `/api/warehouse/products` | GET | bucket-user | `warehouse.products.view` |
| warehouse-putaway-confirm.ts | `/api/warehouse/putaway-confirm` | POST | bucket-user | `warehouse.products.edit` |
| warehouse-putaway-generate.ts | `/api/warehouse/putaway-generate` | POST | bucket-user | `warehouse.products.edit` |
| warehouse-putaway.ts | `/api/warehouse/putaway` | GET | bucket-user | `warehouse.products.view` |
| warehouse-safety-checklists.ts | `/api/warehouse/safety-checklists` | any | bucket-user | `warehouse.business.create`, `warehouse.business.view` |
| warehouse-safety-incident.ts | `/api/warehouse/safety-incident/:id` | any | bucket-user | `warehouse.business.delete`, `warehouse.business.edit` |
| warehouse-safety-incidents.ts | `/api/warehouse/safety-incidents` | any | bucket-user | `warehouse.business.create`, `warehouse.business.view` |
| warehouse-safety-signoff.ts | `/api/warehouse/safety-signoff` | POST | bucket-user | `warehouse.business.edit` |
| warehouse-stock.ts | `/api/warehouse/stock` | GET | bucket-user | `warehouse.products.view` |
| warehouse-transfer.ts | `/api/warehouse/transfer` | POST | bucket-user | `warehouse.products.edit` |

## workforce

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| workforce-approval-inbox.ts | `/api/workforce/approval-inbox` | any | bucket-user | `workforce.employees.view` |
| workforce-approval-routing.ts | `/api/workforce/approval-routing` | any | bucket-user | `workforce.employees.edit`, `workforce.employees.view` |
| workforce-asset-assignments.ts | `/api/workforce/asset-assignments` | any | bucket-user | — |
| workforce-asset.ts | `/api/workforce/asset/:id` | any | bucket-user | — |
| workforce-assets.ts | `/api/workforce/assets` | any | bucket-user | — |
| workforce-attendance-recoveries.ts | `/api/workforce/attendance-recoveries` | any | bucket-user | `workforce.employees.view` |
| workforce-attendance-recovery.ts | `/api/workforce/attendance-recovery/:id` | any | bucket-user | `workforce.employees.edit` |
| workforce-compliance-ops.ts | `/api/workforce/compliance-ops` | any | bucket-user | — |
| workforce-compliance.ts | `/api/workforce/compliance` | any | bucket-user | `workforce.employees.view` |
| workforce-employee-master.ts | `/api/workforce/employee-master` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-employee-profile.ts | `/api/workforce/employee-profile` | any | bucket-user | `workforce.employees.view` |
| workforce-employees-directory.ts | `/api/workforce/employees-directory` | any | bucket-user | `workforce.employees.view` |
| workforce-leave-accrual.ts | `/api/workforce/leave-accrual` | any | bucket-user | — |
| workforce-leave.ts | `/api/workforce/leave/:id` | any | bucket-user | — |
| workforce-leaves.ts | `/api/workforce/leaves` | any | bucket-user | — |
| workforce-me-attendance-recovery.ts | `/api/workforce/me/attendance-recovery` | any | public | — |
| workforce-me-clock-in.ts | `/api/workforce/me/clock-in` | any | public | — |
| workforce-me-clock-out.ts | `/api/workforce/me/clock-out` | any | public | — |
| workforce-me-dashboard.ts | `/api/workforce/me/dashboard` | any | public | — |
| workforce-me-end-break.ts | `/api/workforce/me/end-break` | any | public | — |
| workforce-me-leave-request.ts | `/api/workforce/me/leave-request/:id` | any | public | — |
| workforce-me-leave-requests.ts | `/api/workforce/me/leave-requests` | any | public | — |
| workforce-me-schedule-notice.ts | `/api/workforce/me/schedule-notice/:id` | any | public | — |
| workforce-me-shift-swap.ts | `/api/workforce/me/shift-swap/:id` | any | public | — |
| workforce-me-shift-swaps.ts | `/api/workforce/me/shift-swaps` | any | public | — |
| workforce-me-start-break.ts | `/api/workforce/me/start-break` | any | public | — |
| workforce-me-time-correction-id.ts | `/api/workforce/me/time-correction/:id` | any | public | — |
| workforce-me-time-correction.ts | `/api/workforce/me/time-correction` | any | public | — |
| workforce-me-time-status.ts | `/api/workforce/me/time-status` | any | public | — |
| workforce-overtime-id.ts | `/api/workforce/overtime/:id` | any | bucket-user | `workforce.employees.delete`, `workforce.employees.edit` |
| workforce-overtime.ts | `/api/workforce/overtime` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-payroll-dispute.ts | `/api/workforce/payroll-dispute/:id` | any | bucket-user | — |
| workforce-payroll-disputes.ts | `/api/workforce/payroll-disputes` | any | bucket-user | — |
| workforce-payroll-export.ts | `/api/workforce/payroll-export` | any | bucket-user | — |
| workforce-payroll-id.ts | `/api/workforce/payroll/:id` | any | bucket-user | — |
| workforce-payroll-rates.ts | `/api/workforce/payroll-rates` | any | bucket-user | — |
| workforce-payroll.ts | `/api/workforce/payroll` | any | bucket-user | — |
| workforce-project-assignments.ts | `/api/workforce/project-assignments` | any | bucket-user | `project-service.business.edit` |
| workforce-project-budget.ts | `/api/workforce/project-budget/:id` | any | bucket-user | `project-service.business.edit`, `project-service.business.view` |
| workforce-project-docs.ts | `/api/workforce/project-docs` | any | bucket-user | `project-service.business.edit`, `project-service.business.view` |
| workforce-project-plan-apply.ts | `/api/workforce/project-plan-apply` | any | bucket-user | `project-service.business.edit` |
| workforce-project-plan.ts | `/api/workforce/project-plan` | any | bucket-user | `project-service.business.edit`, `project-service.business.view` |
| workforce-project-risk.ts | `/api/workforce/project-risk/:id` | any | bucket-user | `project-service.business.view` |
| workforce-project-task.ts | `/api/workforce/project-task/:id` | any | bucket-user | `project-service.business.edit` |
| workforce-project-tasks.ts | `/api/workforce/project-tasks` | any | bucket-user | `project-service.business.edit`, `project-service.business.view` |
| workforce-project.ts | `/api/workforce/project/:id` | any | bucket-user | `project-service.business.edit`, `project-service.business.view` |
| workforce-projects.ts | `/api/workforce/projects` | any | bucket-user | `project-service.business.create`, `project-service.business.view` |
| workforce-punch.ts | `/api/workforce/punch/:id` | any | bucket-user | `workforce.employees.delete`, `workforce.employees.edit` |
| workforce-punches.ts | `/api/workforce/punches` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-reporting-dashboard.ts | `/api/workforce/reporting-dashboard` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-schedule-planner.ts | `/api/workforce/schedule-planner` | any | bucket-user | `workforce.employees.edit`, `workforce.employees.view` |
| workforce-schedule-publication.ts | `/api/workforce/schedule-publication` | any | bucket-user | `workforce.employees.edit`, `workforce.employees.view` |
| workforce-sensitive-access.ts | `/api/workforce/sensitive-access` | any | bucket-user | `workforce.employees.edit`, `workforce.employees.view` |
| workforce-shift.ts | `/api/workforce/shift/:id` | any | bucket-user | `workforce.employees.delete` |
| workforce-shifts.ts | `/api/workforce/shifts` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-staff.ts | `/api/workforce/staff` | any | bucket-user | `workforce.employees.view` |
| workforce-swap.ts | `/api/workforce/swap/:id` | any | bucket-user | `workforce.employees.delete`, `workforce.employees.edit` |
| workforce-swaps.ts | `/api/workforce/swaps` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-time-correction.ts | `/api/workforce/time-correction/:id` | any | bucket-user | `workforce.employees.edit` |
| workforce-time-ledger.ts | `/api/workforce/time-ledger` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-timesheet.ts | `/api/workforce/timesheet/:id` | any | bucket-user | `workforce.employees.delete`, `workforce.employees.edit` |
| workforce-timesheets.ts | `/api/workforce/timesheets` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-training-completions.ts | `/api/workforce/training-completions` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-training-course.ts | `/api/workforce/training-course/:id` | any | bucket-user | `workforce.employees.delete`, `workforce.employees.edit` |
| workforce-training-courses.ts | `/api/workforce/training-courses` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-work-locations.ts | `/api/workforce/work-locations` | any | bucket-user | `workforce.employees.edit` |

