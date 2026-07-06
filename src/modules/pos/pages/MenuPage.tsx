import { useEffect, useMemo, useState } from 'react';
import { posApi, type MenuResponse } from '../shared/api';
import { createCartStore } from '../store/cart';
import { MenuSearchBar } from '../components/MenuSearchBar';
import { CategoryTabs } from '../components/CategoryTabs';
import { ProductTile } from '../components/ProductTile';
import { SideCartPanel } from '../components/SideCartPanel';

export interface MenuPageProps {
  bucketId: string;
  userNodeId: string;
  slug: string; // for the Checkout link href
  // Optional menu source — defaults to the authed staff endpoint. The public
  // storefront injects publicApi.getMenu(slug) so the same grid/cart render
  // without a second network call.
  loadMenu?: () => Promise<MenuResponse>;
  // Optional checkout target — defaults to the staff cart route.
  checkoutHref?: string;
  // Catalog Website reuse: hide the cart entirely (no add-to-cart, no side panel).
  // The single "difference" between the storefront and the catalog, as a prop.
  catalogMode?: boolean;
}

export default function MenuPage(props: MenuPageProps) {
  // Cart store keyed by (bucket, user). Memoize so the same store survives renders.
  const useStore = useMemo(
    () => createCartStore(props.bucketId, props.userNodeId),
    [props.bucketId, props.userNodeId],
  );
  const lines = useStore((s) => s.lines);
  const subtotal = useStore((s) => s.subtotalCents());
  const addLine = useStore((s) => s.addLine);
  const setQty = useStore((s) => s.setQty);
  const removeLine = useStore((s) => s.removeLine);

  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string | null>(null);

  const loadMenu = props.loadMenu;
  useEffect(() => {
    let cancel = false;
    (loadMenu ? loadMenu() : posApi.getMenu())
      .then((m) => {
        if (!cancel) setMenu(m);
      })
      .catch(() => {
        if (!cancel) setMenu({ categories: [], products: [] });
      });
    return () => {
      cancel = true;
    };
  }, [loadMenu]);

  const filtered = useMemo(() => {
    if (!menu) return [];
    const q = query.trim().toLowerCase();
    return menu.products.filter((p) => {
      if (cat && p.categoryId !== cat) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [menu, query, cat]);

  const qtyById = useMemo(
    () => Object.fromEntries(lines.map((l) => [l.productId, l.qty])),
    [lines],
  );

  if (!menu) return <div className="pos-loading">Loading menu…</div>;

  const catalogMode = props.catalogMode ?? false;

  return (
    <div className={catalogMode ? 'pos-menu pos-menu--catalog' : 'pos-menu'}>
      <header>
        <MenuSearchBar value={query} onChange={setQuery} />
        <CategoryTabs categories={menu.categories} value={cat} onChange={setCat} />
      </header>
      <main className="pos-menu__grid">
        {filtered.map((p) => (
          <ProductTile
            key={p.id}
            product={p}
            inCartQty={catalogMode ? 0 : (qtyById[p.id] ?? 0)}
            onAdd={catalogMode ? undefined : () => addLine(p)}
          />
        ))}
      </main>
      {!catalogMode && (
        <SideCartPanel
          lines={lines}
          subtotal={subtotal}
          checkoutHref={props.checkoutHref ?? `/c/${props.slug}/pos/cart`}
          onQty={setQty}
          onRemove={removeLine}
        />
      )}
    </div>
  );
}
