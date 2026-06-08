import type { ProductImage } from '../../shared/types';
import { ProductImageGallery } from './ProductImageGallery';

export function ProductMediaSection(props: {
  productId: string | null;
  images: ProductImage[];
  heroKey: string | null;
  onChange: () => Promise<void>;
}) {
  return (
    <div className="pm-section">
      <h3>Media</h3>
      {props.productId
        ? (
          <ProductImageGallery
            productId={props.productId}
            images={props.images}
            heroKey={props.heroKey}
            onChange={props.onChange}
          />
        )
        : <p className="pm-muted">Save the product first to upload images.</p>
      }
    </div>
  );
}
