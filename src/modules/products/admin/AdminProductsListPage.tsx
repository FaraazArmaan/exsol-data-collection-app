import { AdminProductsScopeProvider } from '../shared/scope';
import ProductsListPage from '../workspace/pages/ProductsListPage';

export default function AdminProductsListPage() {
  return (
    <AdminProductsScopeProvider>
      <ProductsListPage />
    </AdminProductsScopeProvider>
  );
}
