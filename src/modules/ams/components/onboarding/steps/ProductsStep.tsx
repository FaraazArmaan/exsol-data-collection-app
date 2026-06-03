// src/modules/ams/components/onboarding/steps/ProductsStep.tsx
import type { WizardState, WizardAction } from '../state';
import { allProducts } from '../../../../registry/products';

interface Props {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

export function ProductsStep({ state, dispatch }: Props) {
  const products = allProducts();
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Enable Products</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Toggle which Products this workspace has access to. Each Product brings its own set of Modules.
        You can change this later in the workspace's Products section.
      </p>
      {products.length === 0 ? (
        <p className="muted">No Products registered yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {products.map((p) => {
            const enabled = state.enabled_products.includes(p.key);
            return (
              <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={enabled}
                  onChange={() => dispatch({ type: 'toggleProduct', productKey: p.key })} />
                <span>
                  <strong>{p.label}</strong>{' '}
                  <span className="muted" style={{ fontSize: 12 }}>{p.key}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
