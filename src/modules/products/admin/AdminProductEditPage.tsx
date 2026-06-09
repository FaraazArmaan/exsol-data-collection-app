import { AdminProductsScopeProvider } from '../shared/scope';
import ProductEditPage from '../workspace/pages/ProductEditPage';

export default function AdminProductEditPage() {
  return (
    <AdminProductsScopeProvider>
      <ProductEditPage />
    </AdminProductsScopeProvider>
  );
}
