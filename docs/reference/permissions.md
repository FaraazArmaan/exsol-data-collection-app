<!--
  GENERATED FILE — do not hand-edit.
  Regenerate with: npm run docs:reference   (scripts/generate-reference.ts)
  Derived from: src/modules/registry/ (manifests, products-list, types)
-->

# Permission model

Keys are `<module>.<bucket>.<verb>` (bucket×verb — iron rule 3), plus fixed
`_platform.<surface>.<verb>` surfaces and POS's FROZEN legacy `pos.<action>` keys.
L1 Owners (`level_number === 1` or null) bypass the matrix everywhere (iron rule 2);
which non-Owner levels hold which keys is per-client runtime data (`client_levels.permissions`
JSONB), edited in the Access Levels dashboard — not derivable from code.

## Modules: buckets × verbs

| module | label | buckets | verbs | sides | dedicated nav |
|---|---|---|---|---|---|
| analytics | Analytics | business, customers, employees, products | view | vendor | ✓ (/analytics) |
| booking | Booking & Calendar | customers, employees | view, create, edit, delete | vendor+customer | ✓ (/booking) |
| catalog | Catalog Website | — | view | customer | ✓ (no link) |
| crm | CRM | customers | view, create, edit, delete | vendor | ✓ (/crm) |
| data-collection | Data Collection | products | view, create, edit, delete | vendor | ✓ (no link) |
| email | Email & Notifications | customers | view | vendor | ✓ (/email) |
| finance | Finance | business | view, create, edit, delete | vendor | ✓ (/finance) |
| hr | Human Resources | employees | view, create, edit, delete | vendor | ✓ (/hr) |
| inventory | Inventory | products | view, create, edit, delete | vendor | ✓ (/inventory/dashboard) |
| manufacturing | Manufacturing | products, business | view, create, edit, delete | vendor | ✓ (/manufacturing) |
| marketing | Marketing | customers | view, create, edit, delete | vendor | ✓ (/marketing) |
| orders | Order Management | business | view, create, edit, delete | vendor | ✓ (/orders) |
| payments | Payments | customers, products | view, create, edit | vendor+customer | generic rail |
| portfolio | Brand Portfolio Site | business | view, edit | vendor+customer | ✓ (/brand-site) |
| pos | POS | — | — | vendor | ✓ (/pos/menu, /pos/sales, /pos/coupons) |
| procurement | Procurement | products | view, create, edit, delete | vendor | ✓ (/procurement) |
| products | Product Manager | products | view, create, edit, delete | vendor+customer | ✓ (/products) |
| project-service | Project Service | business, customers | view, create, edit, delete | vendor | ✓ (no link) |
| supply-chain | Supply Chain | products | view, create, edit, delete | vendor | ✓ (/supply-chain) |
| warehouse | Warehouse | business, products | view, create, edit, delete | vendor | ✓ (/warehouse) |
| workforce | Workforce | employees, leave, payroll, assets | view, create, edit, delete | vendor | ✓ (/workforce) |

Platform surfaces (`_platform.<surface>.<verb>`): `users`, `structure`, `settings`, `files`, `workspace` × `view`, `create`, `edit`, `delete`.

POS legacy action keys (frozen): `pos.menu.view`, `pos.sale.create`, `pos.sale.markPaid`, `pos.sale.fulfill`, `pos.sale.cancel`, `pos.sale.refund`, `pos.history.view`, `pos.history.viewAll`.

## Products → modules

A module is reachable only when an enabled product carries it (iron rule 4).

| product | label | modules (side) | requires |
|---|---|---|---|
| analytics | Analytics | analytics (vendor) | — |
| brand-portfolio | Brand Portfolio Sites | portfolio (both) | — |
| catalog | Catalog Website | catalog (customer) | products |
| crm | Customer Relationship Management | crm (vendor) | — |
| data-collection | Data Collection | data-collection (vendor) | products |
| finance | Finance | finance (vendor) | — |
| hr | Human Resources | hr (vendor) | — |
| inventory | Inventory | inventory (vendor) | products |
| manufacturing | Manufacturing | manufacturing (vendor) | products, inventory |
| marketing | Marketing Automation | marketing (vendor) | — |
| orders | Order Management | orders (vendor) | pos |
| pos | POS | pos (vendor), email (vendor) | products |
| procurement | Procurement | procurement (vendor) | products, inventory |
| products | Products Management | products (both) | — |
| saloon-booking | Saloon Booking System | booking (both), payments (both), products (both), email (vendor) | — |
| supply-chain | Supply Chain | supply-chain (vendor) | — |
| warehouse | Warehouse | warehouse (vendor) | inventory |
| workforce | Workforce & Projects | workforce (vendor), project-service (vendor) | saloon-booking |

## Grantable permission rows (as the Access Levels UI derives them)

Each row is a module×bucket; the UI renders one toggle per verb the module declares.

### analytics

- analytics × business: `analytics.business.view`
- analytics × customers: `analytics.customers.view`
- analytics × employees: `analytics.employees.view`
- analytics × products: `analytics.products.view`

### brand-portfolio

- portfolio × business: `portfolio.business.view` `portfolio.business.edit`

### crm

- crm × customers: `crm.customers.view` `crm.customers.create` `crm.customers.edit` `crm.customers.delete`

### data-collection

- data-collection × products: `data-collection.products.view` `data-collection.products.create` `data-collection.products.edit` `data-collection.products.delete`

### finance

- finance × business: `finance.business.view` `finance.business.create` `finance.business.edit` `finance.business.delete`

### hr

- hr × employees: `hr.employees.view` `hr.employees.create` `hr.employees.edit` `hr.employees.delete`

### inventory

- inventory × products: `inventory.products.view` `inventory.products.create` `inventory.products.edit` `inventory.products.delete`

### manufacturing

- manufacturing × products: `manufacturing.products.view` `manufacturing.products.create` `manufacturing.products.edit` `manufacturing.products.delete`
- manufacturing × business: `manufacturing.business.view` `manufacturing.business.create` `manufacturing.business.edit` `manufacturing.business.delete`

### marketing

- marketing × customers: `marketing.customers.view` `marketing.customers.create` `marketing.customers.edit` `marketing.customers.delete`

### orders

- orders × business: `orders.business.view` `orders.business.create` `orders.business.edit` `orders.business.delete`

### pos

- email × customers: `email.customers.view`

### procurement

- procurement × products: `procurement.products.view` `procurement.products.create` `procurement.products.edit` `procurement.products.delete`

### products

- products × products: `products.products.view` `products.products.create` `products.products.edit` `products.products.delete`

### saloon-booking

- booking × customers: `booking.customers.view` `booking.customers.create` `booking.customers.edit` `booking.customers.delete`
- booking × employees: `booking.employees.view` `booking.employees.create` `booking.employees.edit` `booking.employees.delete`
- payments × customers: `payments.customers.view` `payments.customers.create` `payments.customers.edit`
- payments × products: `payments.products.view` `payments.products.create` `payments.products.edit`
- products × products: `products.products.view` `products.products.create` `products.products.edit` `products.products.delete`
- email × customers: `email.customers.view`

### supply-chain

- supply-chain × products: `supply-chain.products.view` `supply-chain.products.create` `supply-chain.products.edit` `supply-chain.products.delete`

### warehouse

- warehouse × business: `warehouse.business.view` `warehouse.business.create` `warehouse.business.edit` `warehouse.business.delete`
- warehouse × products: `warehouse.products.view` `warehouse.products.create` `warehouse.products.edit` `warehouse.products.delete`

### workforce

- workforce × employees: `workforce.employees.view` `workforce.employees.create` `workforce.employees.edit` `workforce.employees.delete`
- workforce × leave: `workforce.leave.view` `workforce.leave.create` `workforce.leave.edit` `workforce.leave.delete`
- workforce × payroll: `workforce.payroll.view` `workforce.payroll.create` `workforce.payroll.edit` `workforce.payroll.delete`
- workforce × assets: `workforce.assets.view` `workforce.assets.create` `workforce.assets.edit` `workforce.assets.delete`
- project-service × business: `project-service.business.view` `project-service.business.create` `project-service.business.edit` `project-service.business.delete`
- project-service × customers: `project-service.customers.view` `project-service.customers.create` `project-service.customers.edit` `project-service.customers.delete`

