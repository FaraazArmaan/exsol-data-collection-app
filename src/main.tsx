import './lib/theme.css';
import './lib/components.css';
import './components/ui/ui.css';
import './modules/pos/pos.css';
import './modules/files/files.css';
import './modules/inventory/inventory.css';
import './modules/orders/orders.css';
import './modules/procurement/procurement.css';
import './modules/warehouse/warehouse.css';
import './modules/catalog/catalog.css';
import './modules/data-collection/data-collection.css';
import './modules/branding/brand-fonts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
