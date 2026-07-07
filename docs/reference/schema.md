<!--
  GENERATED FILE — do not hand-edit.
  Regenerate with: npm run docs:reference   (scripts/generate-reference.ts)
  Derived from: db/migrations/*.sql (CREATE TABLE / ALTER TABLE statements)
-->

# Database schema by module

32 tables across 66 forward-only migrations.
Columns listed are AS OF CREATION — check the "altered in" migrations (and the live DB)
for the current shape. Migration numbers are allocated by the human coordinator (iron rule 1).

## ams / platform core

### `admins`

- created in `002_admins.sql`
- columns at creation: `id uuid`, `email citext`, `password_hash text`, `google_sub text`, `display_name text`, `is_bootstrap boolean`, `created_at timestamptz`, `updated_at timestamptz`

### `client_cardinality_rules`

- created in `016_client_cardinality_rules.sql`
- columns at creation: `id uuid`, `client_id uuid`, `parent_role_id uuid`, `child_role_id uuid`, `max_children integer`, `created_at timestamptz`

### `client_enabled_products`

- created in `020_client_enabled_products.sql`
- columns at creation: `client_id UUID`, `product_key TEXT`, `enabled_at TIMESTAMPTZ`, `enabled_by_admin UUID`

### `client_levels`

- created in `014_client_levels.sql`; altered in `021_client_levels_permissions.sql`, `036_drop_client_levels_allowed_role_ids.sql`
- columns at creation: `id uuid`, `client_id uuid`, `level_number integer`, `label text`, `allowed_role_ids uuid[]`, `created_at timestamptz`

### `client_roles`

- created in `013_client_roles.sql`; altered in `022_client_roles_bucket_family.sql`
- columns at creation: `id uuid`, `client_id uuid`, `key text`, `label text`, `color text`, `fields jsonb`, `sort_order integer`, `created_at timestamptz`, `updated_at timestamptz`

### `clients`

- created in `003_clients.sql`; altered in `009_clients_slug.sql`, `011_drop_template_columns.sql`, `011b_drop_schema_name.sql`, `047_booking_core.sql`, `137_clients_base_currency.sql`
- columns at creation: `id uuid`, `name text`, `template_key text`, `template_version_applied integer`, `schema_name text`, `created_at timestamptz`, `created_by uuid`

### `login_attempts`

- created in `007_login_attempts.sql`
- columns at creation: `id bigserial`, `attempted_at timestamptz`, `email citext`, `ip inet`, `outcome text`

### `schema_ops_log`

- created in `004_schema_ops_log.sql`; altered in `025_audit_log.sql`
- columns at creation: `id bigserial`, `occurred_at timestamptz`, `actor_admin uuid`, `op text`, `client_id uuid`, `schema_name text`, `template_key text`, `from_version integer`, `to_version integer`, `detail jsonb`

### `user_node_credentials`

- created in `017_user_node_credentials.sql`; altered in `018_user_node_credentials_google_sub.sql`, `019_user_node_credentials_reset_requested.sql`, `023_user_nodes_created_by_admin_nullable.sql`, `024_user_nodes_created_by_user_node.sql`
- columns at creation: `id uuid`, `client_id uuid`, `user_node_id uuid`, `email citext`, `password_hash text`, `must_change_password boolean`, `temp_password_plain text`, `temp_password_views_left integer`, `last_login_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`, `created_by_admin uuid`

### `user_nodes`

- created in `015_user_nodes.sql`; altered in `023_user_nodes_created_by_admin_nullable.sql`, `024_user_nodes_created_by_user_node.sql`
- columns at creation: `id uuid`, `client_id uuid`, `parent_id uuid`, `level_number integer`, `role_id uuid`, `display_name text`, `email citext`, `phone text`, `notes text`, `fields jsonb`, `sort_order integer`, `created_at timestamptz`, `updated_at timestamptz`, `created_by_admin uuid`, `(level_number IS`, `(level_number =`, `(level_number >`, `)`

## booking

### `booking_resource_time_off`

- created in `047_booking_core.sql`
- columns at creation: `id UUID`, `resource_id UUID`, `starts_at TIMESTAMPTZ`, `ends_at TIMESTAMPTZ`, `reason TEXT`, `created_at TIMESTAMPTZ`

### `booking_resources`

- created in `047_booking_core.sql`
- columns at creation: `id UUID`, `bucket_id UUID`, `name TEXT`, `weekly_schedule JSONB`, `active BOOLEAN`, `created_at TIMESTAMPTZ`

### `booking_services`

- created in `047_booking_core.sql`
- columns at creation: `id UUID`, `bucket_id UUID`, `name TEXT`, `duration_min INTEGER`, `price_cents BIGINT`, `payment_mode public.booking_payment_mode`, `deposit_cents BIGINT`, `buffer_min INTEGER`, `active BOOLEAN`, `eligible_resource_ids UUID[]`, `created_at TIMESTAMPTZ`

### `booking_settings`

- created in `047_booking_core.sql`
- columns at creation: `bucket_id UUID`, `slot_interval_min INTEGER`, `lead_time_min INTEGER`, `cancel_cutoff_min INTEGER`, `weekly_schedule JSONB`, `date_overrides JSONB`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `bookings`

- created in `048_bookings.sql`
- columns at creation: `id UUID`, `bucket_id UUID`, `service_id UUID`, `resource_id UUID`, `user_node_id UUID`, `time_range TSTZRANGE`, `status public.booking_status`, `customer_name TEXT`, `customer_phone TEXT`, `customer_email TEXT`, `price_cents BIGINT`, `deposit_paid_cents BIGINT`, `cancellation_reason TEXT`, `cancelled_at TIMESTAMPTZ`, `manage_token TEXT`, `created_by_user_node UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, `(status =`, `OR (status`, `)`, `resource_id WITH`, `time_range WITH`, `) WHERE`

## email

### `email_outbox`

- created in `052_email_outbox.sql`
- columns at creation: `id UUID`, `client_id UUID`, `to_email TEXT`, `template TEXT`, `subject TEXT`, `payload JSONB`, `body_html TEXT`, `status TEXT`, `provider_id TEXT`, `error TEXT`, `created_at TIMESTAMPTZ`, `sent_at TIMESTAMPTZ`

## files (platform)

### `file_allowed_nodes`

- created in `032_file_audience.sql`
- columns at creation: `file_id uuid`, `node_id uuid`

### `file_allowed_roles`

- created in `032_file_audience.sql`
- columns at creation: `file_id uuid`, `role_id uuid`

### `file_allowed_users`

- created in `032_file_audience.sql`
- columns at creation: `file_id uuid`, `user_node_id uuid`

### `file_categories`

- created in `031_file_categories.sql`
- columns at creation: `file_id uuid`, `category_key text`, `'finance_accounting', 'hr_payroll',`, `'marketing_brand', 'product_catalog',`, `'operations_warehouse', 'manufacturing',`, `))`

### `files`

- created in `030_files.sql`
- columns at creation: `id uuid`, `client_id uuid`, `type file_type`, `storage_kind file_storage_kind`, `blob_key text`, `external_url text`, `external_provider text`, `title text`, `description text`, `filename text`, `mime text`, `byte_size bigint`, `thumbnail_key text`, `tier file_tier`, `uploaded_by_user_node uuid`, `uploaded_by_admin uuid`, `created_at timestamptz`, `updated_at timestamptz`, `deleted_at timestamptz`, `(storage_kind =`, `(storage_kind =`, `)`, `(uploaded_by_admin IS`, `)`

### `workspace_storage_quota`

- created in `046_workspace_storage_quota.sql`
- columns at creation: `client_id uuid`, `byte_limit bigint`, `bytes_used_cached bigint`, `updated_at timestamptz`

## finance

### `finance_ai_reports`

- created in `066_finance_ai_reports.sql`
- columns at creation: `client_id UUID`, `month TEXT`, `payload JSONB`, `model TEXT`, `is_fallback BOOLEAN`, `generated_at TIMESTAMPTZ`

### `finance_expenses`

- created in `054_finance_expenses.sql`; altered in `063_finance_expense_currency.sql`, `064_finance_recurring_templates.sql`, `065_finance_approvals.sql`
- columns at creation: `id UUID`, `client_id UUID`, `category TEXT`, `amount_cents BIGINT`, `note TEXT`, `incurred_on DATE`, `created_by UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `finance_recurring_templates`

- created in `064_finance_recurring_templates.sql`
- columns at creation: `id UUID`, `client_id UUID`, `category TEXT`, `amount_cents BIGINT`, `currency TEXT`, `fx_rate NUMERIC(18,6)`, `note TEXT`, `cadence TEXT`, `next_run DATE`, `active BOOLEAN`, `last_materialized_on DATE`, `created_by UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `finance_settings`

- created in `065_finance_approvals.sql`
- columns at creation: `client_id UUID`, `approval_threshold_cents BIGINT`, `updated_at TIMESTAMPTZ`

## login (user-portal auth)

### `bucket_user_credentials`

- created in `008_bucket_user_credentials.sql`
- columns at creation: `id uuid`, `client_id uuid`, `role_key text`, `bucket_user_id uuid`, `email citext`, `password_hash text`, `must_change_password boolean`, `temp_password_plain text`, `temp_password_views_left integer`, `last_login_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`, `created_by_admin uuid`

## portfolio

### `brand_site_config`

- created in `062_brand_site_config.sql`
- columns at creation: `client_id UUID`, `sections JSONB`, `published BOOLEAN`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

## pos

### `sales`

- created in `040_sales.sql`
- columns at creation: `id UUID`, `bucket_id UUID`, `order_no INT`, `status public.sale_status`, `channel public.sale_channel`, `customer_name TEXT`, `customer_phone TEXT`, `customer_email TEXT`, `subtotal_cents BIGINT`, `discount_cents BIGINT`, `tax_cents BIGINT`, `total_cents BIGINT`, `created_by_user_node UUID`, `created_at TIMESTAMPTZ`, `paid_at TIMESTAMPTZ`, `fulfilled_at TIMESTAMPTZ`, `cancelled_at TIMESTAMPTZ`, `refunded_at TIMESTAMPTZ`, `payment_method TEXT`, `payment_ref TEXT`

## products

### `product_categories`

- created in `033_product_categories.sql`
- columns at creation: `id uuid`, `client_id uuid`, `name text`, `sort_order int`, `created_at timestamptz`, `updated_at timestamptz`, `deleted_at timestamptz`

### `product_images`

- created in `035_product_images.sql`
- columns at creation: `id uuid`, `product_id uuid`, `blob_key text`, `sort_order int`, `created_at timestamptz`

### `products`

- created in `034_products.sql`; altered in `037_products_platform_fields.sql`, `038_products_discount_percent.sql`, `039_products_pos_visible.sql`
- columns at creation: `id uuid`, `client_id uuid`, `type product_type`, `name text`, `description text`, `category_id uuid`, `brand text`, `tags text[]`, `price_cents int`, `currency text`, `sku text`, `stock_qty int`, `unit text`, `status product_status`, `hero_image_key text`, `created_by_user_node uuid`, `created_at timestamptz`, `updated_at timestamptz`, `deleted_at timestamptz`, `(type =`, `(type =`, `)`

