import type { ProductManifest, PermissionKey } from '../types';
import { POS_ACTIONS } from '../types';

export const posProduct: ProductManifest = {
  key: 'pos',
  label: 'POS',
  modules: [
    { module: 'pos', side: 'vendor' },
  ],
  requires: ['products'],
  permissions: POS_ACTIONS.map((a) => ({
    key: `pos.${a}` as PermissionKey,
    label: actionLabel(a),
  })),
};

function actionLabel(a: (typeof POS_ACTIONS)[number]): string {
  switch (a) {
    case 'menu.view':       return 'View menu / add to cart';
    case 'sale.create':     return 'Submit cart (creates pending sale)';
    case 'sale.markPaid':   return 'Mark sale paid (cash)';
    case 'sale.fulfill':    return 'Mark sale fulfilled (pickup/online)';
    case 'sale.cancel':     return 'Cancel pending sale';
    case 'sale.refund':     return 'Refund a paid/fulfilled sale';
    case 'history.view':    return 'View own sale history';
    case 'history.viewAll': return 'View all sales (any cashier)';
  }
}
