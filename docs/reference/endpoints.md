<!--
  GENERATED FILE — do not hand-edit.
  Regenerate with: npm run docs:reference   (scripts/generate-reference.ts)
  Derived from: netlify/functions/*.ts (config exports, authz imports, permission-key literals)
-->

# API endpoints

209 functions. "name-routed" = no `config.path`; reachable as `/api/<file>` via the
netlify.toml `/api/* -> /.netlify/functions/:splat` redirect (iron rule 5: the FILE NAME is the route).

Auth tiers: **admin** (`requireAdmin`, AMS console) · **bucket-user** (workspace user via
`requireBucketUser`/`authenticateForPermission`/module `_<key>-authz`) · **public** (no session).

## ams (platform)

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| admin-client-products.ts | `/api/admin-client-products (name-routed)` | any | admin | — |
| admin-self.ts | `/api/admin-self (name-routed)` | any | admin | — |
| admin-team-detail.ts | `/api/admin-team-detail (name-routed)` | any | admin | — |
| admin-team.ts | `/api/admin-team (name-routed)` | any | admin | — |
| audit-log.ts | `/api/audit-log (name-routed)` | any | admin | — |
| client-cardinality.ts | `/api/client-cardinality (name-routed)` | any | admin | — |
| client-levels-detail.ts | `/api/client-levels-detail (name-routed)` | any | admin | — |
| client-levels-permissions.ts | `/api/client-levels-permissions (name-routed)` | any | admin | — |
| client-levels.ts | `/api/client-levels (name-routed)` | any | admin | — |
| client-roles-detail.ts | `/api/client-roles-detail (name-routed)` | any | admin | — |
| client-roles.ts | `/api/client-roles (name-routed)` | any | admin | — |
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
| booking-razorpay-webhook.ts | `/api/booking-public/razorpay-webhook` | POST | public | — |
| booking-resource-detail.ts | `/api/booking/resource-detail/:id` | GET, PATCH, DELETE | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-resource-time-off.ts | `/api/booking/resource-time-off` | GET, POST, DELETE | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-resources.ts | `/api/booking/resources` | GET, POST | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-service-detail.ts | `/api/booking/service-detail/:id` | GET, PATCH, DELETE | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-services.ts | `/api/booking/services` | GET, POST | bucket-user | `booking.employees.edit`, `booking.employees.view` |
| booking-settings.ts | `/api/booking/settings` | GET, PUT | bucket-user | `booking.employees.edit`, `booking.employees.view` |

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
| crm-note-detail.ts | `/api/crm/notes/:id` | PATCH, DELETE | bucket-user | `crm.customers.delete`, `crm.customers.edit` |
| crm-notes.ts | `/api/crm/notes` | POST | bucket-user | `crm.customers.create` |
| crm-refresh.ts | `/api/crm/refresh` | POST | bucket-user | `crm.customers.view` |

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
| auth-logout.ts | `/api/auth-logout (name-routed)` | any | public | — |
| auth-me.ts | `/api/auth-me (name-routed)` | any | admin | — |
| forgot-password.ts | `/api/forgot-password (name-routed)` | any | public | — |
| login.ts | `/api/login (name-routed)` | any | public | — |

## login (user portal)

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| u-change-password.ts | `/api/u-change-password (name-routed)` | any | bucket-user | — |
| u-client-by-slug.ts | `/api/u-client-by-slug (name-routed)` | any | public | — |
| u-link-google.ts | `/api/u-link-google (name-routed)` | any | bucket-user | — |
| u-login.ts | `/api/u-login (name-routed)` | any | public | — |
| u-logout.ts | `/api/u-logout (name-routed)` | any | public | — |
| u-me.ts | `/api/u-me (name-routed)` | any | bucket-user | — |
| u-unlink-google.ts | `/api/u-unlink-google (name-routed)` | any | bucket-user | — |

## manufacturing

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| manufacturing-bom-detail.ts | `/api/manufacturing/bom-detail/:id` | GET, PUT, DELETE | bucket-user | `manufacturing.products.delete`, `manufacturing.products.edit`, `manufacturing.products.view` |
| manufacturing-boms.ts | `/api/manufacturing/boms` | GET, POST | bucket-user | `manufacturing.products.create`, `manufacturing.products.view` |
| manufacturing-order-advance.ts | `/api/manufacturing/order-advance/:id` | POST | bucket-user | `manufacturing.products.edit` |
| manufacturing-orders.ts | `/api/manufacturing/orders` | GET, POST | bucket-user | `manufacturing.products.create`, `manufacturing.products.view` |

## marketing

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| marketing-audience-count.ts | `/api/marketing/audience-count` | GET | bucket-user | `marketing.customers.view` |
| marketing-campaign-create.ts | `/api/marketing/campaigns` | POST | bucket-user | `marketing.customers.create` |
| marketing-campaign-detail.ts | `/api/marketing/campaigns/:id` | GET | bucket-user | `marketing.customers.view` |
| marketing-campaign-send.ts | `/api/marketing/send` | POST | bucket-user | `marketing.customers.edit` |
| marketing-campaigns-list.ts | `/api/marketing/campaigns` | GET | bucket-user | `marketing.customers.view` |

## orders

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| orders-backorder-fulfill.ts | `/api/orders/backorder-fulfill/:id` | POST | bucket-user | `orders.business.edit` |
| orders-backorders.ts | `/api/orders/backorders` | GET, POST | bucket-user | `orders.business.create`, `orders.business.view` |
| orders-dashboard.ts | `/api/orders/dashboard` | GET | bucket-user | `orders.business.view` |
| orders-fulfillment-advance.ts | `/api/orders/fulfillment-advance/:id` | POST | bucket-user | `orders.business.edit` |
| orders-fulfillments.ts | `/api/orders/fulfillments` | GET | bucket-user | `orders.business.view` |
| orders-merge.ts | `/api/orders/merge` | POST | bucket-user | `orders.business.edit` |
| orders-packing-slip.ts | `/api/orders/packing-slip/:id` | GET | bucket-user | `orders.business.view` |
| orders-pick-list.ts | `/api/orders/pick-list/:id` | GET | bucket-user | `orders.business.view` |
| orders-refund-advance.ts | `/api/orders/refund-advance/:id` | POST | bucket-user | `orders.business.edit` |
| orders-refunds.ts | `/api/orders/refunds` | GET, POST | bucket-user | `orders.business.create`, `orders.business.view` |
| orders-sale-lines.ts | `/api/orders/sale-lines/:saleId` | GET | bucket-user | `orders.business.view` |
| orders-shipment-detail.ts | `/api/orders/shipment-detail/:id` | GET, PUT | bucket-user | `orders.business.edit`, `orders.business.view` |
| orders-shipments.ts | `/api/orders/shipments` | GET, POST | bucket-user | `orders.business.create`, `orders.business.view` |
| orders-sla-targets.ts | `/api/orders/sla-targets` | GET, PUT | bucket-user | `orders.business.edit`, `orders.business.view` |
| orders-sla.ts | `/api/orders/sla` | GET | bucket-user | `orders.business.view` |
| orders-split.ts | `/api/orders/split/:saleId` | POST | bucket-user | `orders.business.edit` |

## platform

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| onboard-import.ts | `/api/onboard-import/:token` | POST | public | — |
| onboard-public.ts | `/api/onboard-public/:token` | GET | public | — |
| webhook-example.ts | `/api/webhook-example` | POST | public | — |

## portfolio

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| brand-site.ts | `/api/brand-site` | any | bucket-user | `portfolio.business.edit`, `portfolio.business.view` |

## pos

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| pos-menu.ts | `/api/pos/menu` | any | bucket-user | `pos.menu.view` |
| pos-sale-create.ts | `/api/pos/sales` | POST | bucket-user | `pos.sale.create`, `pos.sale.created` |
| pos-sale-detail.ts | `/api/pos/sales/:id` | any | bucket-user | `pos.history.view`, `pos.history.viewAll` |
| pos-sale-state.ts | `/api/pos/sales/:id/state` | any | bucket-user | `pos.history.view`, `pos.sale.fulfill` |
| pos-sales-list.ts | `/api/pos/sales` | GET | bucket-user | `pos.history.view`, `pos.history.viewAll` |

## pos storefront (public)

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| pub-brand-image.ts | `/api/public/brand/:slug/image/*` | GET | public | — |
| pub-brand.ts | `/api/public/brand/:slug` | GET | public | — |
| pub-menu.ts | `/api/public/menu/:slug` | GET | public | — |
| pub-sale-create.ts | `/api/public/sales` | POST | public | `pos.sale.created` |
| pub-sale-detail.ts | `/api/public/sales/:saleUuid` | GET | public | — |
| pub-site.ts | `/api/public/site/:slug` | GET | public | — |

## procurement

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| procurement-order-detail.ts | `/api/procurement/orders/:id` | GET | bucket-user | `procurement.products.view` |
| procurement-order-transition.ts | `/api/procurement/orders/:id/transition` | POST | bucket-user | `procurement.products.delete`, `procurement.products.edit` |
| procurement-orders.ts | `/api/procurement/orders` | GET, POST | bucket-user | `procurement.products.create`, `procurement.products.view` |
| procurement-products.ts | `/api/procurement/products` | GET | bucket-user | `procurement.products.view` |
| procurement-supplier-detail.ts | `/api/procurement/suppliers/:id` | PATCH, DELETE | bucket-user | `procurement.products.delete`, `procurement.products.edit` |
| procurement-suppliers.ts | `/api/procurement/suppliers` | GET, POST | bucket-user | `procurement.products.create`, `procurement.products.view` |

## products

| function | path | methods | auth | permission keys checked |
|---|---|---|---|---|
| u-product-categories.ts | `/api/u-product-categories (name-routed)` | any | bucket-user | `products.products.create`, `products.products.delete`, `products.products.edit`, `products.products.view` |
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
| warehouse-location.ts | `/api/warehouse/location/:id` | any | bucket-user | `warehouse.business.delete`, `warehouse.business.edit` |
| warehouse-locations.ts | `/api/warehouse/locations` | any | bucket-user | `warehouse.business.create`, `warehouse.business.view` |
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
| workforce-asset-assignments.ts | `/api/workforce/asset-assignments` | any | bucket-user | — |
| workforce-asset.ts | `/api/workforce/asset/:id` | any | bucket-user | — |
| workforce-assets.ts | `/api/workforce/assets` | any | bucket-user | — |
| workforce-compliance.ts | `/api/workforce/compliance` | any | bucket-user | `workforce.employees.view` |
| workforce-employee-profile.ts | `/api/workforce/employee-profile` | any | bucket-user | `workforce.employees.view` |
| workforce-leave.ts | `/api/workforce/leave/:id` | any | bucket-user | — |
| workforce-leaves.ts | `/api/workforce/leaves` | any | bucket-user | — |
| workforce-overtime-id.ts | `/api/workforce/overtime/:id` | any | bucket-user | `workforce.employees.delete`, `workforce.employees.edit` |
| workforce-overtime.ts | `/api/workforce/overtime` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-payroll-id.ts | `/api/workforce/payroll/:id` | any | bucket-user | — |
| workforce-payroll-rates.ts | `/api/workforce/payroll-rates` | any | bucket-user | — |
| workforce-payroll.ts | `/api/workforce/payroll` | any | bucket-user | — |
| workforce-project-assignments.ts | `/api/workforce/project-assignments` | any | bucket-user | `project-service.business.edit` |
| workforce-project.ts | `/api/workforce/project/:id` | any | bucket-user | `project-service.business.edit`, `project-service.business.view` |
| workforce-projects.ts | `/api/workforce/projects` | any | bucket-user | `project-service.business.create`, `project-service.business.view` |
| workforce-punch.ts | `/api/workforce/punch/:id` | any | bucket-user | `workforce.employees.delete`, `workforce.employees.edit` |
| workforce-punches.ts | `/api/workforce/punches` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-shift.ts | `/api/workforce/shift/:id` | any | bucket-user | `workforce.employees.delete` |
| workforce-shifts.ts | `/api/workforce/shifts` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-staff.ts | `/api/workforce/staff` | any | bucket-user | `workforce.employees.view` |
| workforce-swap.ts | `/api/workforce/swap/:id` | any | bucket-user | `workforce.employees.delete`, `workforce.employees.edit` |
| workforce-swaps.ts | `/api/workforce/swaps` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-timesheet.ts | `/api/workforce/timesheet/:id` | any | bucket-user | `workforce.employees.delete`, `workforce.employees.edit` |
| workforce-timesheets.ts | `/api/workforce/timesheets` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-training-completions.ts | `/api/workforce/training-completions` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |
| workforce-training-course.ts | `/api/workforce/training-course/:id` | any | bucket-user | `workforce.employees.delete`, `workforce.employees.edit` |
| workforce-training-courses.ts | `/api/workforce/training-courses` | any | bucket-user | `workforce.employees.create`, `workforce.employees.view` |

