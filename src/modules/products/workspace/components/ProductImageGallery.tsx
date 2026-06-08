import { useId, useState } from 'react';
import type { ProductImage } from '../../shared/types';
import { imagesApi } from '../../shared/api';

const MAX_IMAGES = 20;

export function ProductImageGallery(props: {
  productId: string;
  images: ProductImage[];
  heroKey: string | null;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let next = props.images.length;
      for (const f of Array.from(files)) {
        if (next >= MAX_IMAGES) break;
        await imagesApi.upload(props.productId, f, next++);
      }
      await props.onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        className="pm-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files); }}
      >
        <input
          id={inputId}
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => void onFiles(e.target.files)}
          hidden
        />
        <label htmlFor={inputId}>
          {busy ? 'Uploading…' : 'Drop images here or click to browse'}
        </label>
      </div>

      {error && <p className="pm-error" role="alert">{error}</p>}

      {props.images.length > 0 && (
        <div className="pm-img-row" role="list" aria-label="Uploaded images">
          {props.images.map((im) => (
            <div
              key={im.id}
              role="listitem"
              className={`pm-img-tile${im.blob_key === props.heroKey ? ' is-hero' : ''}`}
              title={im.blob_key}
            >
              {/* No thumbnail endpoint exists yet — render the blob_key as a
                  placeholder. The hero outline still shows which image was
                  picked. Wiring real thumbnails is a follow-up. */}
              <div className="pm-thumb pm-thumb-placeholder" style={{ width: '100%', height: '100%' }} />
              <button
                type="button"
                className="pm-img-x"
                aria-label="Remove image"
                onClick={async () => {
                  if (!confirm('Remove this image?')) return;
                  try { await imagesApi.remove(im.id); await props.onChange(); }
                  catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {props.images.length >= MAX_IMAGES && (
        <p className="pm-muted">Maximum {MAX_IMAGES} images reached.</p>
      )}
    </div>
  );
}
