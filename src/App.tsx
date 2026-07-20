import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './lib/auth-context';
import { AppearanceProvider } from './lib/appearance';
import { router } from './lib/router';

export default function App() {
  return (
    <AppearanceProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </AppearanceProvider>
  );
}
