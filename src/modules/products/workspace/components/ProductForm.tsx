import { useEffect } from 'react';
import type {
  Product, ProductWithImages, ProductCategory, ProductType, ProductStatus,
} from '../../shared/types';
import { ProductBasicsSection } from './ProductBasicsSection';
import { ProductPricingSection } from './ProductPricingSection';
import { ProductMediaSection } from './ProductMediaSection';
import { ProductOrgSection } from './ProductOrgSection';

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
});

export function ProductForm(props: {
  draft: ProductDraft;
  loaded: ProductWithImages | null;
  categories: ProductCategory[];
  onChange: (patch: Partial<ProductDraft>) => void;
  onReloadImages: () => Promise<void>;
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
          onChange={props.onReloadImages}
        />
        <ProductOrgSection
          category_id={props.draft.category_id}
          brand={props.draft.brand}
          tags={props.draft.tags}
          status={props.draft.status}
          categories={props.categories}
          onChange={(p) => props.onChange(p as Partial<ProductDraft>)}
        />
      </div>
    </div>
  );
}

// Re-export helpers for callers
export type { ProductType, ProductStatus };
