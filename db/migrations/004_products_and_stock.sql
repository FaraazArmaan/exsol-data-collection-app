CREATE TYPE product_type AS ENUM ('physical_goods', 'food_item');
CREATE TYPE product_status AS ENUM ('draft', 'active', 'archived');
CREATE TYPE marketplace AS ENUM (
  'amazon', 'flipkart', 'meta', 'wa',
  'rakuten', 'aliexpress', 'swiggy', 'zomato'
);
CREATE TYPE movement_reason AS ENUM (
  'purchase', 'sale', 'damage', 'recount', 'manual_adjust'
);
CREATE TYPE movement_source AS ENUM ('manual', 'csv', 'recount');

CREATE TABLE categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  parent_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_categories_unique_name
  ON categories(workspace_id, name, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE products (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sku                     text NOT NULL,
  name                    text NOT NULL,
  description             text,
  product_type            product_type NOT NULL DEFAULT 'physical_goods',
  category_id             uuid REFERENCES categories(id),
  sub_category_id         uuid REFERENCES categories(id),
  primary_image_drive_id  text,
  extra_image_drive_ids   text[] NOT NULL DEFAULT '{}',
  price                   numeric(12,2) NOT NULL DEFAULT 0,
  currency                text NOT NULL DEFAULT 'INR',
  cost                    numeric(12,2),
  stock_count             integer NOT NULL DEFAULT 0,
  stock_unit              text NOT NULL DEFAULT 'piece',
  weight_g                integer,
  dim_l_mm                integer,
  dim_w_mm                integer,
  dim_h_mm                integer,
  barcode                 text,
  hsn_code                text,
  gst_rate                numeric(4,2),
  food_fields             jsonb,
  tags                    text[] NOT NULL DEFAULT '{}',
  low_stock_threshold     integer,
  dead_stock_days         integer,
  status                  product_status NOT NULL DEFAULT 'draft',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES users(id),
  UNIQUE (workspace_id, sku)
);

CREATE INDEX idx_products_workspace_status ON products(workspace_id, status);
CREATE INDEX idx_products_updated ON products(workspace_id, updated_at DESC);
CREATE INDEX idx_products_search ON products
  USING gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(sku, '')));

CREATE TABLE product_marketplace_fields (
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  marketplace  marketplace NOT NULL,
  fields       jsonb NOT NULL DEFAULT '{}',
  enabled      boolean NOT NULL DEFAULT false,
  last_synced  timestamptz,
  workspace_id uuid NOT NULL,
  PRIMARY KEY (product_id, marketplace)
);

CREATE INDEX idx_pmf_workspace ON product_marketplace_fields(workspace_id);
CREATE INDEX idx_pmf_enabled ON product_marketplace_fields(workspace_id, marketplace) WHERE enabled = true;
CREATE INDEX idx_pmf_fields_gin ON product_marketplace_fields USING gin (fields jsonb_path_ops);

CREATE TABLE stock_movements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta        integer NOT NULL,
  reason       movement_reason NOT NULL,
  source       movement_source NOT NULL,
  external_ref text,
  actor_id     uuid REFERENCES users(id),
  on_behalf_of uuid REFERENCES users(id),
  note         text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_movements_workspace ON stock_movements(workspace_id, occurred_at DESC);
CREATE INDEX idx_movements_product ON stock_movements(product_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION stock_movements_apply_delta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products
    SET stock_count = stock_count + NEW.delta,
        updated_at = now()
    WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_movements_apply
AFTER INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION stock_movements_apply_delta();
