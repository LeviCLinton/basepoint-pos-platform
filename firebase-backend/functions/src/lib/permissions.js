// Single source of truth for permissions on the Firebase side. Deliberately
// kept structurally identical to the frontend prototype's PERMISSION_CATALOG
// and the Express backend's src/lib/permissions.js, so a permission id means
// the same thing everywhere. If you're running both backends side by side
// during a migration, keep these three files in sync by hand for now.

const PERMISSION_CATALOG = [
  { category: 'pos', permissions: [
    'pos.view', 'pos.sale.create', 'pos.order.cancel', 'pos.discount.apply',
    'pos.discount.custom', 'pos.refund', 'pos.void', 'pos.history.view',
  ]},
  { category: 'products', permissions: [
    'products.view', 'products.create', 'products.edit', 'products.delete',
    'products.price.edit', 'products.cost.edit',
  ]},
  { category: 'inventory', permissions: [
    'inventory.view', 'inventory.adjust', 'inventory.purchase.create', 'inventory.purchase.receive',
  ]},
  { category: 'sales', permissions: [
    'sales.view', 'sales.create', 'sales.refund', 'sales.void',
  ]},
  { category: 'customers', permissions: [
    'customers.view', 'customers.create', 'customers.edit', 'customers.delete',
  ]},
  { category: 'suppliers', permissions: [
    'suppliers.view', 'suppliers.create', 'suppliers.edit',
  ]},
  { category: 'expenses', permissions: [
    'expenses.view', 'expenses.create', 'expenses.approve',
  ]},
  { category: 'reports', permissions: [
    'reports.view', 'reports.financial',
  ]},
  { category: 'employees', permissions: [
    'employees.view', 'employees.create', 'employees.edit', 'employees.delete', 'employees.assignRoles',
  ]},
  { category: 'settings', permissions: [
    'settings.view', 'settings.edit',
  ]},
  { category: 'devices', permissions: [
    'devices.view', 'devices.manage',
  ]},
  { category: 'auditLogs', permissions: [
    'auditLogs.view',
  ]},
  { category: 'subscription', permissions: [
    'subscription.view', 'subscription.manage',
  ]},
];

const ALL_PERMISSION_IDS = PERMISSION_CATALOG.flatMap(c => c.permissions);

// Default permission sets for the seeded system roles (Section 8 of the spec).
// Owner always gets every permission and is never editable/deletable — that's
// enforced in code wherever roles are written, not just here.
const SYSTEM_ROLE_DEFAULTS = {
  Owner: {
    isOwner: true, isSystem: true,
    description: 'Full control of the company, subscription, and every module.',
    permissions: ALL_PERMISSION_IDS,
  },
  Manager: {
    isSystem: true,
    description: 'Operational management. No subscription, ownership, or unrestricted employee admin.',
    permissions: [
      'pos.view', 'pos.sale.create', 'pos.refund', 'pos.discount.apply', 'pos.history.view',
      'inventory.view', 'inventory.adjust', 'inventory.purchase.create', 'inventory.purchase.receive',
      'products.view', 'products.create', 'products.edit', 'products.price.edit',
      'sales.view', 'sales.refund',
      'customers.view', 'customers.create', 'customers.edit',
      'suppliers.view', 'suppliers.create', 'suppliers.edit',
      'reports.view', 'devices.view',
    ],
  },
  Accountant: {
    isSystem: true,
    description: 'Financial visibility. No checkout access, no employee management.',
    permissions: ['sales.view', 'reports.view', 'reports.financial', 'expenses.view', 'expenses.approve', 'auditLogs.view'],
  },
  Supervisor: {
    isSystem: true,
    description: 'Shift and register supervision.',
    permissions: ['pos.view', 'pos.sale.create', 'pos.discount.apply', 'pos.refund', 'inventory.view', 'reports.view'],
  },
  Cashier: {
    isSystem: true,
    description: 'Register access: create sales, accept payments, print receipts.',
    permissions: ['pos.view', 'pos.sale.create', 'pos.history.view', 'products.view', 'customers.view', 'customers.create'],
  },
};

function permissionExists(id) {
  return ALL_PERMISSION_IDS.includes(id);
}

/** Effective permissions = role permissions, plus additional grants, minus explicit restrictions. */
function effectivePermissions({ rolePermissions = [], additionalPermissions = [], restrictedPermissions = [] }) {
  const set = new Set(rolePermissions);
  additionalPermissions.forEach(p => set.add(p));
  restrictedPermissions.forEach(p => set.delete(p));
  return set;
}

function hasPermission({ isOwner, rolePermissions, additionalPermissions, restrictedPermissions }, permissionId) {
  if (isOwner) return true;
  return effectivePermissions({ rolePermissions, additionalPermissions, restrictedPermissions }).has(permissionId);
}

module.exports = { PERMISSION_CATALOG, ALL_PERMISSION_IDS, SYSTEM_ROLE_DEFAULTS, permissionExists, effectivePermissions, hasPermission };
