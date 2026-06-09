import { useEffect } from 'react';
import type {
  Product, ProductWithImages, ProductCategory, ProductType, ProductStatus,
} from '../../shared/types';
import { ProductBasicsSection } from './ProductBasicsSection';
import { ProductPricingSection } from './ProductPricingSection';
import { ProductMediaSection } from './ProductMediaSection';
import { ProductOrgSection } from './ProductOrgSection';
import { ProductCommerceSection } from './ProductCommerceSection';
import { ProductPhysicalAttrsSection } from './ProductPhysicalAttrsSection';
import { ProductTaxonomySection } from './ProductTaxonomySection';

export interface ProductDraft
  extends Omit<Product, 'id' | 'created_at' | 'updated_at' | 'currency'> {}

export const emptyDraft = (): ProductDraft => ({
  type: 'physical',
  name: '',
  description: null,
  category_id: null,
  brand: null,
  tags: [],
  price_cents: 0,
  sku: null,
  stock_qty: 0,
  unit: 'each',
  status: 'draft',
  hero_image_key: null,
  hero_image_id: null,

  // Phase B
  gtin: null,
  mpn: null,
  condition: 'new',
  availability: 'in_stock',
  sale_price_cents: null,
  sale_starts_at: null,
  sale_ends_at: null,
  weight_grams: null,
  length_mm: null,
  width_mm: null,
  height_mm: null,
  color: null,
  size: null,
  material: null,
  gender: null,
  age_group: null,
  manufacturer: null,
  country_of_origin: null,
  hsn_code: null,
  gst_rate: null,
  google_category: null,
  meta_category: null,
  product_url: null,
  platform_extras: {},
});

export function ProductForm(props: {
  draft: ProductDraft;
  loaded: ProductWithImages | null;
  categories: ProductCategory[];
  pendingImages: File[];
  onPendingImagesChange: (files: File[]) => void;
  onChange: (patch: Partial<ProductDraft>) => void;
  onReloadImages: () => Promise<void>;
  canManageCategories?: boolean;
  onCreateCategory?: (name: string) => Promise<ProductCategory>;
}) {
  // When type flips to 'service', null out physical-only fields so they don't
  // leak in the PATCH payload. The server also validates this, but doing it
  // client-side keeps the UX honest (no "ghost SKU" after toggling).
  useEffect(() => {
    if (props.draft.type === 'service' && (props.draft.sku || props.draft.stock_qty || props.draft.unit)) {
      props.onChange({ sku: null, stock_qty: null, unit: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.draft.type]);

  return (
    <>
      <div className="pm-form-grid">
        <div className="pm-form-col">
          <ProductBasicsSection
            type={props.draft.type}
            name={props.draft.name}
            description={props.draft.description}
            onChange={(p) => props.onChange(p as Partial<ProductDraft>)}
          />
          <ProductPricingSection
            type={props.draft.type}
            price_cents={props.draft.price_cents}
            sku={props.draft.sku}
            stock_qty={props.draft.stock_qty}
            unit={props.draft.unit}
            onChange={(p) => props.onChange(p as Partial<ProductDraft>)}
          />
        </div>
        <div className="pm-form-col">
          <ProductMediaSection
            productId={props.loaded?.id ?? null}
            images={props.loaded?.images ?? []}
            heroKey={props.loaded?.hero_image_key ?? null}
            pendingImages={props.pendingImages}
            onPendingImagesChange={props.onPendingImagesChange}
            onChange={props.onReloadImages}
          />
          <ProductOrgSection
            category_id={props.draft.category_id}
            brand={props.draft.brand}
            tags={props.draft.tags}
            status={props.draft.status}
            categories={props.categories}
            canManageCategories={props.canManageCategories}
            onCreateCategory={props.onCreateCategory}
            onChange={(p) => props.onChange(p as Partial<ProductDraft>)}
          />
        </div>
      </div>

      <ProductCommerceSection
        gtin={props.draft.gtin}
        mpn={props.draft.mpn}
        condition={props.draft.condition}
        availability={props.draft.availability}
        sale_price_cents={props.draft.sale_price_cents}
        sale_starts_at={props.draft.sale_starts_at}
        sale_ends_at={props.draft.sale_ends_at}
        weight_grams={props.draft.weight_grams}
        onChange={(p) => props.onChange(p as Partial<ProductDraft>)}
      />

      <ProductPhysicalAttrsSection
        length_mm={props.draft.length_mm}
        width_mm={props.draft.width_mm}
        height_mm={props.draft.height_mm}
        color={props.draft.color}
        size={props.draft.size}
        material={props.draft.material}
        gender={props.draft.gender}
        age_group={props.draft.age_group}
        manufacturer={props.draft.manufacturer}
        country_of_origin={props.draft.country_of_origin}
        onChange={(p) => props.onChange(p as Partial<ProductDraft>)}
      />

      <ProductTaxonomySection
        google_category={props.draft.google_category}
        meta_category={props.draft.meta_category}
        hsn_code={props.draft.hsn_code}
        gst_rate={props.draft.gst_rate}
        product_url={props.draft.product_url}
        onChange={(p) => props.onChange(p as Partial<ProductDraft>)}
      />
    </>
  );
}

// Re-export helpers for callers
export type { ProductType, ProductStatus };
