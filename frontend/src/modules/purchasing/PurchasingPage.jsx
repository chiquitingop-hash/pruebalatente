import { useState } from 'react';
import PurchaseOrdersTab from './PurchaseOrdersTab';
import ShipmentsTab from './ShipmentsTab';
import InvoicesTab from './InvoicesTab';
import SupplierNotesTab from './SupplierNotesTab';

const TABS = [
  { key: 'orders',    label: 'Órdenes de compra (exterior)' },
  { key: 'shipments', label: 'Embarques' },
  { key: 'invoices',  label: 'Facturas proveedor' },
  { key: 'notes',     label: 'Guías proveedor (local)' },
];

const PurchasingPage = () => {
  const [active, setActive] = useState('orders');

  return (
    <div className="space-y-4">
      <div className="border-b border-gray-200">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${active === t.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {active === 'orders'    && <PurchaseOrdersTab />}
      {active === 'shipments' && <ShipmentsTab />}
      {active === 'invoices'  && <InvoicesTab />}
      {active === 'notes'     && <SupplierNotesTab />}
    </div>
  );
};

export default PurchasingPage;

