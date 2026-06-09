import { AdminProductsScopeProvider } from '../shared/scope';
import ProductCategoriesPage from '../workspace/pages/ProductCategoriesPage';

export default function AdminProductCategoriesPage() {
  return (
    <AdminProductsScopeProvider>
      <ProductCategoriesPage />
    </AdminProductsScopeProvider>
  );
}
