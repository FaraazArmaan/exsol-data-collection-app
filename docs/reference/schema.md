<!--
  GENERATED FILE — do not hand-edit.
  Regenerate with: npm run docs:reference   (scripts/generate-reference.ts)
  Derived from: db/migrations/*.sql (CREATE TABLE / ALTER TABLE statements)
-->

# Database schema by module

151 tables across 143 forward-only migrations.
Columns listed are AS OF CREATION — check the "altered in" migrations (and the live DB)
for the current shape. Migration numbers are allocated by the human coordinator (iron rule 1).

## ams / platform core

### `admins`

- created in `002_admins.sql`; altered in `142_login_ams_admin_rbac.sql`, `143_login_ams_account_lifecycle.sql`
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

### `client_tax_config`

- created in `128_client_tax_config.sql`
- columns at creation: `client_id UUID`, `enabled BOOLEAN`, `rate_bps INTEGER`, `label TEXT`, `inclusive BOOLEAN`, `updated_at TIMESTAMPTZ`

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

- created in `017_user_node_credentials.sql`; altered in `018_user_node_credentials_google_sub.sql`, `019_user_node_credentials_reset_requested.sql`, `023_user_nodes_created_by_admin_nullable.sql`, `024_user_nodes_created_by_user_node.sql`, `143_login_ams_account_lifecycle.sql`
- columns at creation: `id uuid`, `client_id uuid`, `user_node_id uuid`, `email citext`, `password_hash text`, `must_change_password boolean`, `temp_password_plain text`, `temp_password_views_left integer`, `last_login_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`, `created_by_admin uuid`

### `user_nodes`

- created in `015_user_nodes.sql`; altered in `023_user_nodes_created_by_admin_nullable.sql`, `024_user_nodes_created_by_user_node.sql`
- columns at creation: `id uuid`, `client_id uuid`, `parent_id uuid`, `level_number integer`, `role_id uuid`, `display_name text`, `email citext`, `phone text`, `notes text`, `fields jsonb`, `sort_order integer`, `created_at timestamptz`, `updated_at timestamptz`, `created_by_admin uuid`, `(level_number IS`, `(level_number =`, `(level_number >`, `)`

## booking

### `booking_appointment_lines`

- created in `153_booking_visits_appointment_lines.sql`
- columns at creation: `id UUID`, `visit_id UUID`, `service_id UUID`, `sequence_number INTEGER`, `resource_id UUID`, `time_range TSTZRANGE`, `duration_min INTEGER`, `buffer_min INTEGER`, `price_cents BIGINT`, `created_at TIMESTAMPTZ`

### `booking_events`

- created in `155_booking_lifecycle_events.sql`
- columns at creation: `id UUID`, `visit_id UUID`, `bucket_id UUID`, `actor_user_node UUID`, `source TEXT`, `event_type TEXT`, `previous_state JSONB`, `new_state JSONB`, `reason TEXT`, `reference TEXT`, `created_at TIMESTAMPTZ`

### `booking_line_reservations`

- created in `153_booking_visits_appointment_lines.sql`
- columns at creation: `id UUID`, `visit_id UUID`, `appointment_line_id UUID`, `resource_id UUID`, `time_range TSTZRANGE`, `status public.booking_status`, `created_at TIMESTAMPTZ`, `resource_id WITH`, `time_range WITH`, `) WHERE`

### `booking_policies`

- created in `154_booking_policies.sql`
- columns at creation: `bucket_id UUID`, `version INTEGER`, `cancel_cutoff_min INTEGER`, `reschedule_cutoff_min INTEGER`, `max_customer_reschedules INTEGER`, `late_arrival_grace_min INTEGER`, `no_show_outcome TEXT`, `cancellation_settlement TEXT`, `late_reschedule_action TEXT`, `late_reschedule_fee_cents BIGINT`, `deposit_requirement TEXT`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

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

### `booking_setup`

- created in `152_booking_setup.sql`; altered in `157_booking_publication.sql`
- columns at creation: `bucket_id UUID`, `booking_party_mode TEXT`, `bookable_kinds TEXT[]`, `extra_capacity_needs TEXT[]`, `availability_source TEXT`, `display_labels JSONB`, `reservation_rules JSONB`, `setup_version INTEGER`, `completed_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `booking_visits`

- created in `153_booking_visits_appointment_lines.sql`; altered in `154_booking_policies.sql`, `155_booking_lifecycle_events.sql`
- columns at creation: `id UUID`, `bucket_id UUID`, `user_node_id UUID`, `time_range TSTZRANGE`, `status public.booking_status`, `customer_name TEXT`, `customer_phone TEXT`, `customer_email TEXT`, `price_cents BIGINT`, `deposit_paid_cents BIGINT`, `cancellation_reason TEXT`, `cancelled_at TIMESTAMPTZ`, `manage_token TEXT`, `created_by_user_node UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `bookings`

- created in `048_bookings.sql`; altered in `153_booking_visits_appointment_lines.sql`
- columns at creation: `id UUID`, `bucket_id UUID`, `service_id UUID`, `resource_id UUID`, `user_node_id UUID`, `time_range TSTZRANGE`, `status public.booking_status`, `customer_name TEXT`, `customer_phone TEXT`, `customer_email TEXT`, `price_cents BIGINT`, `deposit_paid_cents BIGINT`, `cancellation_reason TEXT`, `cancelled_at TIMESTAMPTZ`, `manage_token TEXT`, `created_by_user_node UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, `(status =`, `OR (status`, `)`, `resource_id WITH`, `time_range WITH`, `) WHERE`

## crm

### `crm_customers`

- created in `055_crm.sql`
- columns at creation: `id uuid`, `client_id uuid`, `display_name text`, `phone text`, `email text`, `dedupe_key text`, `source text`, `first_seen timestamptz`, `last_seen timestamptz`, `created_at timestamptz`, `updated_at timestamptz`

### `crm_leads`

- created in `102_crm_leads.sql`
- columns at creation: `id UUID`, `client_id UUID`, `name TEXT`, `email TEXT`, `phone TEXT`, `message TEXT`, `source TEXT`, `status TEXT`, `converted_customer_id UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `crm_notes`

- created in `055_crm.sql`
- columns at creation: `id uuid`, `client_id uuid`, `customer_id uuid`, `body text`, `created_by_user_node uuid`, `created_at timestamptz`, `updated_at timestamptz`

### `crm_social_connections`

- created in `103_crm_social_connections.sql`
- columns at creation: `id UUID`, `client_id UUID`, `provider TEXT`, `status TEXT`, `account_label TEXT`, `imported_total INT`, `last_imported_at TIMESTAMPTZ`, `connected_at TIMESTAMPTZ`, `created_by_user_node UUID`, `updated_at TIMESTAMPTZ`

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

- created in `054_finance_expenses.sql`; altered in `063_finance_expense_currency.sql`, `064_finance_recurring_templates.sql`, `065_finance_approvals.sql`, `108_project_budget.sql`
- columns at creation: `id UUID`, `client_id UUID`, `category TEXT`, `amount_cents BIGINT`, `note TEXT`, `incurred_on DATE`, `created_by UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `finance_recurring_templates`

- created in `064_finance_recurring_templates.sql`
- columns at creation: `id UUID`, `client_id UUID`, `category TEXT`, `amount_cents BIGINT`, `currency TEXT`, `fx_rate NUMERIC(18,6)`, `note TEXT`, `cadence TEXT`, `next_run DATE`, `active BOOLEAN`, `last_materialized_on DATE`, `created_by UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `finance_settings`

- created in `065_finance_approvals.sql`
- columns at creation: `client_id UUID`, `approval_threshold_cents BIGINT`, `updated_at TIMESTAMPTZ`

## inventory

### `inventory_reservations`

- created in `165_inventory_stock_reservations.sql`; altered in `166_inventory_reservation_partial_consumption.sql`
- columns at creation: `id uuid`, `client_id uuid`, `sale_id uuid`, `sale_line_id uuid`, `product_id uuid`, `variant_id uuid`, `qty int`, `status inventory_reservation_status`, `released_at timestamptz`, `consumed_at timestamptz`, `created_at timestamptz`

### `inventory_returns`

- created in `080_inventory_returns.sql`
- columns at creation: `id uuid`, `client_id uuid`, `product_id uuid`, `qty int`, `disposition text`, `reason text`, `created_by uuid`, `created_at timestamptz`

### `inventory_stock`

- created in `053_inventory.sql`; altered in `164_product_variants_and_sale_snapshots.sql`, `165_inventory_stock_reservations.sql`
- columns at creation: `id uuid`, `client_id uuid`, `product_id uuid`, `qty_on_hand int`, `reorder_level int`, `created_at timestamptz`, `updated_at timestamptz`

## login (user-portal auth)

### `bucket_user_credentials`

- created in `008_bucket_user_credentials.sql`
- columns at creation: `id uuid`, `client_id uuid`, `role_key text`, `bucket_user_id uuid`, `email citext`, `password_hash text`, `must_change_password boolean`, `temp_password_plain text`, `temp_password_views_left integer`, `last_login_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`, `created_by_admin uuid`

## manufacturing

### `manufacturing_consumption_lots`

- created in `077_manufacturing_lots.sql`
- columns at creation: `id uuid`, `client_id uuid`, `production_order_id uuid`, `component_product_id uuid`, `lot_ref text`, `qty int`, `created_at timestamptz`

### `manufacturing_maintenance_logs`

- created in `078_manufacturing_maintenance.sql`
- columns at creation: `id uuid`, `client_id uuid`, `kind text`, `resource_label text`, `reason text`, `minutes int`, `occurred_on date`, `notes text`, `created_by uuid`, `created_at timestamptz`

### `manufacturing_product_costs`

- created in `075_manufacturing_costs.sql`
- columns at creation: `id uuid`, `client_id uuid`, `product_id uuid`, `unit_cost_cents bigint`, `updated_at timestamptz`

### `manufacturing_qc_checks`

- created in `076_manufacturing_qc.sql`
- columns at creation: `id uuid`, `client_id uuid`, `production_order_id uuid`, `item text`, `result text`, `disposition text`, `scrap_qty int`, `notes text`, `created_at timestamptz`, `updated_at timestamptz`

### `manufacturing_resources`

- created in `079_manufacturing_capacity.sql`
- columns at creation: `id uuid`, `client_id uuid`, `name text`, `hours_per_day int`, `created_at timestamptz`, `updated_at timestamptz`

### `manufacturing_scrap_logs`

- created in `078_manufacturing_maintenance.sql`
- columns at creation: `id uuid`, `client_id uuid`, `product_id uuid`, `qty int`, `reason text`, `occurred_on date`, `created_by uuid`, `created_at timestamptz`

## marketing

### `marketing_campaign_events`

- created in `133_marketing_ab.sql`
- columns at creation: `id uuid`, `client_id uuid`, `campaign_id uuid`, `send_id uuid`, `kind text`, `url text`, `created_at timestamptz`

### `marketing_campaigns`

- created in `060_marketing.sql`
- columns at creation: `id uuid`, `client_id uuid`, `name text`, `subject text`, `body_html text`, `audience text`, `status text`, `sent_at timestamptz`, `created_by_user_node uuid`, `created_at timestamptz`, `updated_at timestamptz`

### `marketing_consent_log`

- created in `135_marketing_gdpr.sql`
- columns at creation: `id uuid`, `client_id uuid`, `email text`, `channel text`, `granted boolean`, `source text`, `created_at timestamptz`

### `marketing_erasure_log`

- created in `135_marketing_gdpr.sql`
- columns at creation: `id uuid`, `client_id uuid`, `email text`, `requested_by_user_node uuid`, `affected jsonb`, `created_at timestamptz`

### `marketing_social_posts`

- created in `136_marketing_social.sql`
- columns at creation: `id uuid`, `client_id uuid`, `provider text`, `content text`, `scheduled_for timestamptz`, `status text`, `posted_at timestamptz`, `provider_ref text`, `error text`, `created_by_user_node uuid`, `created_at timestamptz`, `updated_at timestamptz`

### `marketing_webhook_endpoints`

- created in `134_marketing_webhooks.sql`
- columns at creation: `id uuid`, `client_id uuid`, `label text`, `token text`, `secret text`, `active boolean`, `created_at timestamptz`

### `marketing_webhook_events`

- created in `134_marketing_webhooks.sql`
- columns at creation: `id uuid`, `client_id uuid`, `endpoint_id uuid`, `event_type text`, `payload jsonb`, `triggered_count integer`, `created_at timestamptz`

### `marketing_webhook_triggers`

- created in `134_marketing_webhooks.sql`
- columns at creation: `id uuid`, `client_id uuid`, `event_type text`, `campaign_id uuid`, `active boolean`, `created_at timestamptz`

## platform (unmapped prefix)

### `abandoned_carts`

- created in `127_abandoned_carts.sql`
- columns at creation: `id UUID`, `client_id UUID`, `session_key TEXT`, `customer_name TEXT`, `customer_email TEXT`, `channel TEXT`, `lines JSONB`, `subtotal_cents INTEGER`, `status TEXT`, `reminded_at TIMESTAMPTZ`, `converted_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `admin_mfa`

- created in `139_login_ams_mfa.sql`
- columns at creation: `admin_id uuid`, `totp_secret text`, `enabled_at timestamptz`, `recovery_code_hashes jsonb`, `created_at timestamptz`, `updated_at timestamptz`

### `admin_mfa_challenges`

- created in `139_login_ams_mfa.sql`
- columns at creation: `id uuid`, `admin_id uuid`, `ip inet`, `user_agent text`, `created_at timestamptz`, `expires_at timestamptz`, `consumed_at timestamptz`

### `asn_lines`

- created in `094_warehouse_asn.sql`
- columns at creation: `id uuid`, `asn_id uuid`, `product_id uuid`, `expected_qty int`, `received_qty int`, `created_at timestamptz`

### `asset_assignments`

- created in `118_assets.sql`
- columns at creation: `id UUID`, `client_id UUID`, `asset_id UUID`, `user_node_id UUID`, `assigned_at TIMESTAMPTZ`, `returned_at TIMESTAMPTZ`, `condition_at_return TEXT`, `notes TEXT`

### `auth_sessions`

- created in `138_login_ams_sessions.sql`; altered in `140_login_ams_impersonation_audit.sql`
- columns at creation: `id uuid`, `realm text`, `subject_id uuid`, `client_id uuid`, `email text`, `user_agent text`, `ip inet`, `created_at timestamptz`, `expires_at timestamptz`, `revoked_at timestamptz`

### `bom_components`

- created in `058_manufacturing.sql`
- columns at creation: `id uuid`, `bom_id uuid`, `component_product_id uuid`, `qty int`

### `boms`

- created in `058_manufacturing.sql`
- columns at creation: `id uuid`, `client_id uuid`, `output_product_id uuid`, `name text`, `created_at timestamptz`, `updated_at timestamptz`

### `campaign_sends`

- created in `060_marketing.sql`
- columns at creation: `id uuid`, `client_id uuid`, `campaign_id uuid`, `customer_id uuid`, `recipient_email text`, `status text`, `provider_id text`, `error text`, `created_at timestamptz`

### `co2_emission_factors`

- created in `098_co2_emission_factors.sql`
- columns at creation: `id uuid`, `client_id uuid`, `category_id uuid`, `kg_co2_per_unit numeric(12,3)`, `created_at timestamptz`, `updated_at timestamptz`

### `coupon_redemptions`

- created in `124_coupons.sql`
- columns at creation: `id UUID`, `coupon_id UUID`, `sale_id UUID`, `customer_key TEXT`, `discount_cents INTEGER`, `created_at TIMESTAMPTZ`

### `coupons`

- created in `124_coupons.sql`
- columns at creation: `id UUID`, `client_id UUID`, `code TEXT`, `discount_type TEXT`, `discount_value INTEGER`, `min_order_cents INTEGER`, `max_redemptions INTEGER`, `per_customer_limit INTEGER`, `redeemed_count INTEGER`, `starts_at TIMESTAMPTZ`, `expires_at TIMESTAMPTZ`, `active BOOLEAN`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `goods_receipt_items`

- created in `072_procurement_three_way_match.sql`
- columns at creation: `id uuid`, `goods_receipt_id uuid`, `product_id uuid`, `qty_received int`, `created_at timestamptz`

### `goods_receipts`

- created in `072_procurement_three_way_match.sql`
- columns at creation: `id uuid`, `client_id uuid`, `purchase_order_id uuid`, `received_on date`, `note text`, `created_by uuid`, `created_at timestamptz`

### `hr_checklist_instance_items`

- created in `120_hr_checklists.sql`
- columns at creation: `id uuid`, `instance_id uuid`, `position integer`, `label text`, `description text`, `action_hint text`, `done boolean`, `done_at timestamptz`, `done_by_user_node uuid`

### `hr_checklist_instances`

- created in `120_hr_checklists.sql`
- columns at creation: `id uuid`, `client_id uuid`, `kind text`, `subject_user_node_id uuid`, `subject_name text`, `template_id uuid`, `status text`, `created_by_user_node uuid`, `created_at timestamptz`, `completed_at timestamptz`

### `hr_checklist_template_items`

- created in `120_hr_checklists.sql`
- columns at creation: `id uuid`, `template_id uuid`, `position integer`, `label text`, `description text`, `action_hint text`

### `hr_checklist_templates`

- created in `120_hr_checklists.sql`
- columns at creation: `id uuid`, `client_id uuid`, `kind text`, `name text`, `is_default boolean`, `created_at timestamptz`, `updated_at timestamptz`

### `inbound_asns`

- created in `094_warehouse_asn.sql`
- columns at creation: `id uuid`, `client_id uuid`, `purchase_order_id uuid`, `reference text`, `carrier text`, `eta date`, `status text`, `notes text`, `created_by uuid`, `created_at timestamptz`, `updated_at timestamptz`

### `leave_balances`

- created in `112_leave_requests.sql`
- columns at creation: `id UUID`, `client_id UUID`, `resource_id UUID`, `leave_type TEXT`, `balance_days NUMERIC(6,1)`, `updated_at TIMESTAMPTZ`

### `leave_requests`

- created in `112_leave_requests.sql`
- columns at creation: `id UUID`, `client_id UUID`, `resource_id UUID`, `user_node_id UUID`, `leave_type TEXT`, `start_date DATE`, `end_date DATE`, `notes TEXT`, `status TEXT`, `handled_by UUID`, `handled_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `onboard_tokens`

- created in `061_onboard_tokens.sql`
- columns at creation: `id uuid`, `client_id uuid`, `token text`, `expires_at timestamptz`, `used_at timestamptz`, `created_by uuid`, `created_at timestamptz`

### `orders_backorders`

- created in `088_orders_backorders.sql`
- columns at creation: `id uuid`, `client_id uuid`, `sale_id uuid`, `product_id uuid`, `product_name_snap text`, `qty_ordered int`, `qty_fulfilled int`, `status backorder_status`, `created_at timestamptz`, `updated_at timestamptz`, `fulfilled_at timestamptz`

### `orders_fulfillment_lines`

- created in `090_orders_fulfillments.sql`
- columns at creation: `id uuid`, `fulfillment_id uuid`, `sale_line_id uuid`, `qty int`

### `orders_fulfillments`

- created in `090_orders_fulfillments.sql`
- columns at creation: `id uuid`, `client_id uuid`, `sale_id uuid`, `label text`, `status fulfillment_status`, `created_at timestamptz`, `updated_at timestamptz`, `fulfilled_at timestamptz`

### `orders_merge_groups`

- created in `091_orders_merge.sql`
- columns at creation: `id uuid`, `client_id uuid`, `primary_sale_id uuid`, `customer_key text`, `created_at timestamptz`

### `orders_merge_members`

- created in `091_orders_merge.sql`
- columns at creation: `id uuid`, `group_id uuid`, `sale_id uuid`

### `orders_refunds`

- created in `087_orders_refunds_shipments.sql`
- columns at creation: `id uuid`, `client_id uuid`, `sale_id uuid`, `amount_cents bigint`, `reason text`, `state refund_state`, `requested_by uuid`, `created_at timestamptz`, `updated_at timestamptz`, `completed_at timestamptz`

### `orders_shipments`

- created in `087_orders_refunds_shipments.sql`
- columns at creation: `id uuid`, `client_id uuid`, `sale_id uuid`, `carrier text`, `tracking_ref text`, `status shipment_status`, `shipped_at timestamptz`, `delivered_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`

### `orders_sla_targets`

- created in `089_orders_sla.sql`
- columns at creation: `id uuid`, `client_id uuid`, `stage order_stage`, `max_minutes int`

### `orders_stage_events`

- created in `089_orders_sla.sql`
- columns at creation: `id uuid`, `client_id uuid`, `sale_id uuid`, `stage order_stage`, `entered_at timestamptz`, `source text`

### `overtime_entries`

- created in `114_overtime_entries.sql`
- columns at creation: `id UUID`, `client_id UUID`, `resource_id UUID`, `user_node_id UUID`, `punch_id UUID`, `ot_date DATE`, `ot_hours NUMERIC(5,2)`, `reason TEXT`, `status TEXT`, `handled_by UUID`, `handled_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `payment_allocations`

- created in `159_payments_core.sql`
- columns at creation: `id UUID`, `client_id UUID`, `transaction_id UUID`, `request_id UUID`, `amount_minor BIGINT`, `created_at TIMESTAMPTZ`

### `payment_attempts`

- created in `161_payment_provider_attempts_webhooks.sql`
- columns at creation: `id UUID`, `client_id UUID`, `request_id UUID`, `provider TEXT`, `status TEXT`, `provider_order_id TEXT`, `provider_payment_id TEXT`, `amount_minor BIGINT`, `currency CHAR(3)`, `expires_at TIMESTAMPTZ`, `failure_reason TEXT`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `payment_provider_connections`

- created in `160_payment_provider_connections.sql`
- columns at creation: `id UUID`, `client_id UUID`, `provider TEXT`, `mode TEXT`, `key_id TEXT`, `api_secret_enc TEXT`, `webhook_secret_enc TEXT`, `enabled BOOLEAN`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `payment_requests`

- created in `159_payments_core.sql`
- columns at creation: `id UUID`, `client_id UUID`, `source_type TEXT`, `source_id UUID`, `purpose TEXT`, `amount_minor BIGINT`, `currency CHAR(3)`, `status TEXT`, `expires_at TIMESTAMPTZ`, `source_snapshot JSONB`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `payment_transactions`

- created in `159_payments_core.sql`; altered in `162_orders_refund_payment_links.sql`
- columns at creation: `id UUID`, `client_id UUID`, `kind TEXT`, `status TEXT`, `amount_minor BIGINT`, `currency CHAR(3)`, `provider TEXT`, `provider_transaction_id TEXT`, `reference TEXT`, `actor_user_node UUID`, `occurred_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`

### `payment_webhook_events`

- created in `161_payment_provider_attempts_webhooks.sql`
- columns at creation: `id UUID`, `client_id UUID`, `attempt_id UUID`, `provider TEXT`, `provider_event_id TEXT`, `event_type TEXT`, `payload JSONB`, `status TEXT`, `reason TEXT`, `received_at TIMESTAMPTZ`, `processed_at TIMESTAMPTZ`

### `payroll_periods`

- created in `116_payroll.sql`
- columns at creation: `id UUID`, `client_id UUID`, `period_start DATE`, `period_end DATE`, `status TEXT`, `total_amount NUMERIC(12,2)`, `created_by UUID`, `approved_by UUID`, `approved_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `payroll_rates`

- created in `116_payroll.sql`
- columns at creation: `id UUID`, `client_id UUID`, `user_node_id UUID`, `hourly_rate NUMERIC(10,2)`, `effective_from DATE`, `notes TEXT`, `created_at TIMESTAMPTZ`

### `production_orders`

- created in `058_manufacturing.sql`
- columns at creation: `id uuid`, `client_id uuid`, `bom_id uuid`, `qty int`, `status production_order_status`, `created_by uuid`, `created_at timestamptz`, `updated_at timestamptz`, `completed_at timestamptz`

### `projects`

- created in `059_workforce.sql`; altered in `108_project_budget.sql`
- columns at creation: `id UUID`, `client_id UUID`, `name TEXT`, `customer_id UUID`, `status TEXT`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `purchase_order_items`

- created in `056_procurement.sql`
- columns at creation: `id uuid`, `purchase_order_id uuid`, `product_id uuid`, `qty int`, `unit_cost_cents bigint`, `created_at timestamptz`

### `purchase_orders`

- created in `056_procurement.sql`
- columns at creation: `id uuid`, `client_id uuid`, `supplier_id uuid`, `status purchase_order_status`, `expected_on date`, `notes text`, `created_by uuid`, `received_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`

### `safety_checklist_signoffs`

- created in `095_warehouse_safety.sql`
- columns at creation: `id uuid`, `signed_by uuid`, `notes text`, `signed_at timestamptz`

### `safety_checklists`

- created in `095_warehouse_safety.sql`
- columns at creation: `id uuid`, `client_id uuid`, `title text`, `cadence text`, `active boolean`, `created_at timestamptz`, `updated_at timestamptz`

### `safety_incidents`

- created in `095_warehouse_safety.sql`
- columns at creation: `id uuid`, `client_id uuid`, `occurred_on date`, `severity text`, `location_id uuid`, `title text`, `description text`, `status text`, `reported_by uuid`, `created_at timestamptz`, `updated_at timestamptz`

### `shift_swaps`

- created in `115_shift_swaps.sql`
- columns at creation: `id UUID`, `client_id UUID`, `offering_shift_id UUID`, `offering_resource_id UUID`, `offering_date DATE`, `claimed_by_resource_id UUID`, `claimed_at TIMESTAMPTZ`, `status TEXT`, `notes TEXT`, `handled_by UUID`, `handled_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `stock_by_location`

- created in `057_warehouse.sql`
- columns at creation: `id uuid`, `location_id uuid`, `product_id uuid`, `qty int`, `created_at timestamptz`, `updated_at timestamptz`

### `stock_movements`

- created in `053_inventory.sql`; altered in `164_product_variants_and_sale_snapshots.sql`
- columns at creation: `id uuid`, `client_id uuid`, `product_id uuid`, `qty_delta int`, `type stock_movement_type`, `ref text`, `created_by uuid`, `created_at timestamptz`

### `storefront_cms`

- created in `129_storefront_cms.sql`
- columns at creation: `client_id UUID`, `sections JSONB`, `published BOOLEAN`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `supplier_contacts`

- created in `069_procurement_supplier_deepen.sql`
- columns at creation: `id uuid`, `client_id uuid`, `supplier_id uuid`, `name text`, `role text`, `phone text`, `email text`, `created_at timestamptz`

### `supplier_invoices`

- created in `072_procurement_three_way_match.sql`
- columns at creation: `id uuid`, `client_id uuid`, `purchase_order_id uuid`, `invoice_number text`, `amount_cents bigint`, `invoice_date date`, `created_by uuid`, `created_at timestamptz`

### `supplier_prices`

- created in `070_procurement_supplier_prices.sql`
- columns at creation: `id uuid`, `client_id uuid`, `supplier_id uuid`, `product_id uuid`, `unit_cost_cents bigint`, `effective_from date`, `created_by uuid`, `created_at timestamptz`

### `suppliers`

- created in `056_procurement.sql`
- columns at creation: `id uuid`, `client_id uuid`, `name text`, `phone text`, `email text`, `notes text`, `created_at timestamptz`, `updated_at timestamptz`, `deleted_at timestamptz`

### `timesheet_entries`

- created in `107_timesheet_entries.sql`
- columns at creation: `id UUID`, `client_id UUID`, `resource_id UUID`, `user_node_id UUID`, `entry_date DATE`, `start_time TIME`, `end_time TIME`, `notes TEXT`, `approved_by UUID`, `approved_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `training_completions`

- created in `117_training.sql`
- columns at creation: `id UUID`, `client_id UUID`, `course_id UUID`, `resource_id UUID`, `user_node_id UUID`, `completed_at DATE`, `expires_at DATE`, `cert_url TEXT`, `notes TEXT`, `created_at TIMESTAMPTZ`

### `training_courses`

- created in `117_training.sql`
- columns at creation: `id UUID`, `client_id UUID`, `name TEXT`, `description TEXT`, `is_required BOOLEAN`, `expiry_days INTEGER`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `user_credential_tokens`

- created in `141_login_ams_invite_reset_tokens.sql`
- columns at creation: `id uuid`, `token_hash text`, `purpose text`, `client_id uuid`, `user_node_id uuid`, `credential_id uuid`, `email citext`, `created_by_admin uuid`, `created_by_user_node uuid`, `created_at timestamptz`, `expires_at timestamptz`, `consumed_at timestamptz`

## portfolio

### `brand_site_config`

- created in `062_brand_site_config.sql`
- columns at creation: `client_id UUID`, `sections JSONB`, `published BOOLEAN`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

## pos

### `sale_lines`

- created in `041_sale_lines.sql`; altered in `164_product_variants_and_sale_snapshots.sql`
- columns at creation: `id uuid`, `sale_id uuid`, `product_id uuid`, `product_name_snap text`, `unit_price_cents bigint`, `qty int`, `line_total_cents bigint`, `position int`, `created_at timestamptz`

### `sales`

- created in `040_sales.sql`
- columns at creation: `id UUID`, `bucket_id UUID`, `order_no INT`, `status public.sale_status`, `channel public.sale_channel`, `customer_name TEXT`, `customer_phone TEXT`, `customer_email TEXT`, `subtotal_cents BIGINT`, `discount_cents BIGINT`, `tax_cents BIGINT`, `total_cents BIGINT`, `created_by_user_node UUID`, `created_at TIMESTAMPTZ`, `paid_at TIMESTAMPTZ`, `fulfilled_at TIMESTAMPTZ`, `cancelled_at TIMESTAMPTZ`, `refunded_at TIMESTAMPTZ`, `payment_method TEXT`, `payment_ref TEXT`

## products

### `product_bundle_items`

- created in `126_product_bundles.sql`
- columns at creation: `id UUID`, `bundle_product_id UUID`, `component_product_id UUID`, `qty INTEGER`, `position INTEGER`, `created_at TIMESTAMPTZ`

### `product_categories`

- created in `033_product_categories.sql`
- columns at creation: `id uuid`, `client_id uuid`, `name text`, `sort_order int`, `created_at timestamptz`, `updated_at timestamptz`, `deleted_at timestamptz`

### `product_images`

- created in `035_product_images.sql`
- columns at creation: `id uuid`, `product_id uuid`, `blob_key text`, `sort_order int`, `created_at timestamptz`

### `product_reviews`

- created in `125_product_reviews.sql`
- columns at creation: `id UUID`, `client_id UUID`, `product_id UUID`, `kind TEXT`, `rating INTEGER`, `author_name TEXT`, `author_email TEXT`, `body TEXT`, `answer TEXT`, `status TEXT`, `created_at TIMESTAMPTZ`, `moderated_at TIMESTAMPTZ`

### `product_suppliers`

- created in `097_product_suppliers.sql`
- columns at creation: `id uuid`, `client_id uuid`, `product_id uuid`, `supplier_id uuid`, `lead_time_days int`, `unit_cost_cents bigint`, `is_primary boolean`, `created_at timestamptz`, `updated_at timestamptz`

### `product_variants`

- created in `164_product_variants_and_sale_snapshots.sql`
- columns at creation: `id uuid`, `client_id uuid`, `product_id uuid`, `title text`, `option_values jsonb`, `sku text`, `barcode text`, `price_cents int`, `sale_price_cents int`, `sale_starts_at timestamptz`, `sale_ends_at timestamptz`, `status product_status`, `availability text`, `pos_visible boolean`, `storefront_visible boolean`, `created_at timestamptz`, `updated_at timestamptz`

### `products`

- created in `034_products.sql`; altered in `037_products_platform_fields.sql`, `038_products_discount_percent.sql`, `039_products_pos_visible.sql`
- columns at creation: `id uuid`, `client_id uuid`, `type product_type`, `name text`, `description text`, `category_id uuid`, `brand text`, `tags text[]`, `price_cents int`, `currency text`, `sku text`, `stock_qty int`, `unit text`, `status product_status`, `hero_image_key text`, `created_by_user_node uuid`, `created_at timestamptz`, `updated_at timestamptz`, `deleted_at timestamptz`, `(type =`, `(type =`, `)`

## warehouse

### `warehouse_locations`

- created in `057_warehouse.sql`
- columns at creation: `id uuid`, `client_id uuid`, `name text`, `kind text`, `created_at timestamptz`, `updated_at timestamptz`

### `warehouse_putaway_tasks`

- created in `093_warehouse_putaway.sql`
- columns at creation: `id uuid`, `client_id uuid`, `purchase_order_id uuid`, `purchase_order_item_id uuid`, `product_id uuid`, `qty int`, `status text`, `location_id uuid`, `done_by uuid`, `done_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`

### `warehouse_slotting_suggestions`

- created in `096_warehouse_slotting.sql`
- columns at creation: `id uuid`, `client_id uuid`, `product_id uuid`, `from_location_id uuid`, `to_location_id uuid`, `suggested_qty int`, `velocity int`, `rationale text`, `ai_fallback boolean`, `status text`, `decided_by uuid`, `decided_at timestamptz`, `created_at timestamptz`

## workforce / project-service

### `project_ai_plans`

- created in `111_project_ai_plans.sql`
- columns at creation: `id UUID`, `client_id UUID`, `project_id UUID`, `prompt_text TEXT`, `draft_tasks JSONB`, `generated_by UUID`, `created_at TIMESTAMPTZ`

### `project_assignments`

- created in `059_workforce.sql`
- columns at creation: `project_id UUID`, `resource_id UUID`, `assigned_at TIMESTAMPTZ`

### `project_files`

- created in `109_project_documents.sql`
- columns at creation: `project_id UUID`, `file_id UUID`, `attached_at TIMESTAMPTZ`, `attached_by UUID`

### `project_tasks`

- created in `110_project_tasks.sql`
- columns at creation: `id UUID`, `client_id UUID`, `project_id UUID`, `title TEXT`, `description TEXT`, `assigned_to UUID`, `status TEXT`, `due_date DATE`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_asset_maintenance`

- created in `149_training_assets_compliance_ops.sql`
- columns at creation: `id UUID`, `client_id UUID`, `asset_id UUID`, `scheduled_for DATE`, `completed_at TIMESTAMPTZ`, `status TEXT`, `notes TEXT`, `performed_by UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_assets`

- created in `118_assets.sql`
- columns at creation: `id UUID`, `client_id UUID`, `name TEXT`, `description TEXT`, `serial_number TEXT`, `condition TEXT`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_compliance_requirements`

- created in `149_training_assets_compliance_ops.sql`
- columns at creation: `id UUID`, `client_id UUID`, `requirement_type TEXT`, `name TEXT`, `description TEXT`, `course_id UUID`, `asset_id UUID`, `required_for_employment_type TEXT`, `due_within_days INTEGER`, `recurrence_days INTEGER`, `active BOOLEAN`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_compliance_rules`

- created in `145_scheduling_compliance_planner.sql`
- columns at creation: `id UUID`, `client_id UUID`, `name TEXT`, `max_daily_hours NUMERIC(4,2)`, `max_weekly_hours NUMERIC(5,2)`, `break_required_after_hours NUMERIC(4,2)`, `min_break_minutes INTEGER`, `effective_from DATE`, `effective_to DATE`, `active BOOLEAN`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_compliance_tasks`

- created in `149_training_assets_compliance_ops.sql`
- columns at creation: `id UUID`, `client_id UUID`, `requirement_id UUID`, `resource_id UUID`, `user_node_id UUID`, `status TEXT`, `due_date DATE`, `completed_at TIMESTAMPTZ`, `source_type TEXT`, `source_id UUID`, `notes TEXT`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_dashboard_snapshots`

- created in `150_reporting_dashboard_indexes_snapshots.sql`
- columns at creation: `id UUID`, `client_id UUID`, `snapshot_date DATE`, `metrics JSONB`, `created_by UUID`, `created_at TIMESTAMPTZ`

### `workforce_employee_profiles`

- created in `144_employee_master_profile.sql`
- columns at creation: `id UUID`, `client_id UUID`, `resource_id UUID`, `user_node_id UUID`, `employee_number TEXT`, `legal_name TEXT`, `preferred_name TEXT`, `employment_status TEXT`, `employment_type TEXT`, `job_title TEXT`, `department TEXT`, `hire_date DATE`, `termination_date DATE`, `manager_user_node_id UUID`, `primary_email TEXT`, `primary_phone TEXT`, `emergency_contact JSONB`, `custom_fields JSONB`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_holidays`

- created in `147_leave_accrual_holiday_calendar.sql`
- columns at creation: `id UUID`, `client_id UUID`, `name TEXT`, `holiday_date DATE`, `region TEXT`, `paid BOOLEAN`, `created_at TIMESTAMPTZ`

### `workforce_leave_ledger`

- created in `147_leave_accrual_holiday_calendar.sql`
- columns at creation: `id UUID`, `client_id UUID`, `resource_id UUID`, `leave_type TEXT`, `entry_date DATE`, `entry_type TEXT`, `days_delta NUMERIC(6,2)`, `request_id UUID`, `notes TEXT`, `created_by UUID`, `created_at TIMESTAMPTZ`

### `workforce_leave_policies`

- created in `147_leave_accrual_holiday_calendar.sql`
- columns at creation: `id UUID`, `client_id UUID`, `leave_type TEXT`, `accrual_rate_days NUMERIC(6,2)`, `accrual_period TEXT`, `carryover_cap_days NUMERIC(6,2)`, `effective_from DATE`, `effective_to DATE`, `active BOOLEAN`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_payroll_exports`

- created in `148_payroll_export_payslips.sql`
- columns at creation: `id UUID`, `client_id UUID`, `period_id UUID`, `export_format TEXT`, `status TEXT`, `total_amount NUMERIC(12,2)`, `exported_by UUID`, `exported_at TIMESTAMPTZ`, `file_id UUID`, `metadata JSONB`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_payslips`

- created in `148_payroll_export_payslips.sql`
- columns at creation: `id UUID`, `client_id UUID`, `export_id UUID`, `period_id UUID`, `user_node_id UUID`, `gross_amount NUMERIC(12,2)`, `tax_amount NUMERIC(12,2)`, `deductions_amount NUMERIC(12,2)`, `net_amount NUMERIC(12,2)`, `currency TEXT`, `status TEXT`, `published_at TIMESTAMPTZ`, `metadata JSONB`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_punch_breaks`

- created in `151_workforce_self_service_geofence_time_clock.sql`
- columns at creation: `id UUID`, `client_id UUID`, `punch_id UUID`, `resource_id UUID`, `user_node_id UUID`, `started_at TIMESTAMPTZ`, `ended_at TIMESTAMPTZ`, `source TEXT`, `notes TEXT`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_punches`

- created in `113_workforce_punches.sql`
- columns at creation: `id UUID`, `client_id UUID`, `resource_id UUID`, `user_node_id UUID`, `shift_id UUID`, `punched_in_at TIMESTAMPTZ`, `punched_out_at TIMESTAMPTZ`, `late_minutes SMALLINT`, `is_absent BOOLEAN`, `notes TEXT`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_schedule_compliance_findings`

- created in `145_scheduling_compliance_planner.sql`
- columns at creation: `id UUID`, `client_id UUID`, `resource_id UUID`, `shift_id UUID`, `rule_id UUID`, `schedule_date DATE`, `finding_type TEXT`, `severity TEXT`, `details JSONB`, `status TEXT`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_shifts`

- created in `059_workforce.sql`
- columns at creation: `id UUID`, `client_id UUID`, `resource_id UUID`, `user_node_id UUID`, `weekday SMALLINT`, `start_time TIME`, `end_time TIME`, `created_at TIMESTAMPTZ`

### `workforce_time_clock_events`

- created in `146_time_clock_ledger_corrections.sql`; altered in `151_workforce_self_service_geofence_time_clock.sql`
- columns at creation: `id UUID`, `client_id UUID`, `resource_id UUID`, `user_node_id UUID`, `punch_id UUID`, `event_type TEXT`, `occurred_at TIMESTAMPTZ`, `source TEXT`, `notes TEXT`, `metadata JSONB`, `recorded_by UUID`, `created_at TIMESTAMPTZ`

### `workforce_time_corrections`

- created in `146_time_clock_ledger_corrections.sql`
- columns at creation: `id UUID`, `client_id UUID`, `punch_id UUID`, `resource_id UUID`, `requested_by UUID`, `correction_type TEXT`, `original_values JSONB`, `new_values JSONB`, `status TEXT`, `reviewed_by UUID`, `reviewed_at TIMESTAMPTZ`, `notes TEXT`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

### `workforce_work_location_assignments`

- created in `151_workforce_self_service_geofence_time_clock.sql`
- columns at creation: `id UUID`, `client_id UUID`, `work_location_id UUID`, `applies_to_all BOOLEAN`, `resource_id UUID`, `user_node_id UUID`, `active BOOLEAN`, `created_at TIMESTAMPTZ`

### `workforce_work_locations`

- created in `151_workforce_self_service_geofence_time_clock.sql`
- columns at creation: `id UUID`, `client_id UUID`, `name TEXT`, `latitude NUMERIC(9,6)`, `longitude NUMERIC(9,6)`, `radius_meters INTEGER`, `min_accuracy_meters INTEGER`, `active BOOLEAN`, `created_by UUID`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`

