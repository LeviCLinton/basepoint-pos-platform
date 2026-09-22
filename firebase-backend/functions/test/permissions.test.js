const { hasPermission, effectivePermissions, permissionExists, SYSTEM_ROLE_DEFAULTS, ALL_PERMISSION_IDS } = require('../src/lib/permissions');

describe('effectivePermissions', () => {
  test('starts from role permissions', () => {
    const set = effectivePermissions({ rolePermissions: ['pos.view', 'pos.sale.create'] });
    expect([...set].sort()).toEqual(['pos.sale.create', 'pos.view']);
  });

  test('additional permissions are added on top of the role', () => {
    const set = effectivePermissions({ rolePermissions: ['pos.view'], additionalPermissions: ['pos.refund'] });
    expect(set.has('pos.refund')).toBe(true);
    expect(set.has('pos.view')).toBe(true);
  });

  test('restricted permissions remove from the role, even if listed there', () => {
    const set = effectivePermissions({ rolePermissions: ['pos.view', 'pos.refund'], restrictedPermissions: ['pos.refund'] });
    expect(set.has('pos.refund')).toBe(false);
    expect(set.has('pos.view')).toBe(true);
  });

  test('restriction wins even if the same permission is also (redundantly) granted as additional', () => {
    const set = effectivePermissions({
      rolePermissions: [],
      additionalPermissions: ['pos.refund'],
      restrictedPermissions: ['pos.refund'],
    });
    expect(set.has('pos.refund')).toBe(false);
  });
});

describe('hasPermission', () => {
  test('owner has every permission regardless of role/overrides', () => {
    for (const id of ['pos.view', 'employees.delete', 'subscription.manage']) {
      expect(hasPermission({ isOwner: true, rolePermissions: [], additionalPermissions: [], restrictedPermissions: [id] }, id)).toBe(true);
    }
  });

  test('a cashier does not have employees.delete by default', () => {
    const cashierPerms = SYSTEM_ROLE_DEFAULTS.Cashier.permissions;
    expect(hasPermission({ isOwner: false, rolePermissions: cashierPerms }, 'employees.delete')).toBe(false);
  });

  test('a cashier granted an explicit additional permission gets it', () => {
    const cashierPerms = SYSTEM_ROLE_DEFAULTS.Cashier.permissions;
    expect(hasPermission({ isOwner: false, rolePermissions: cashierPerms, additionalPermissions: ['pos.refund'] }, 'pos.refund')).toBe(true);
  });

  test('a manager can be restricted below their role default', () => {
    const managerPerms = SYSTEM_ROLE_DEFAULTS.Manager.permissions;
    expect(managerPerms).toContain('pos.refund');
    expect(hasPermission({ isOwner: false, rolePermissions: managerPerms, restrictedPermissions: ['pos.refund'] }, 'pos.refund')).toBe(false);
  });
});

describe('SYSTEM_ROLE_DEFAULTS sanity checks', () => {
  test('every permission referenced by a default role actually exists in the catalog', () => {
    for (const [roleName, def] of Object.entries(SYSTEM_ROLE_DEFAULTS)) {
      for (const id of def.permissions) {
        expect(permissionExists(id)).toBe(true);
      }
    }
  });

  test('Owner is the only role flagged isOwner, and it has every permission', () => {
    const ownerRoles = Object.entries(SYSTEM_ROLE_DEFAULTS).filter(([, def]) => def.isOwner);
    expect(ownerRoles.length).toBe(1);
    expect(ownerRoles[0][0]).toBe('Owner');
    expect(new Set(ownerRoles[0][1].permissions)).toEqual(new Set(ALL_PERMISSION_IDS));
  });

  test('no non-owner role is accidentally granted every permission (would defeat RBAC)', () => {
    for (const [roleName, def] of Object.entries(SYSTEM_ROLE_DEFAULTS)) {
      if (def.isOwner) continue;
      expect(def.permissions.length).toBeLessThan(ALL_PERMISSION_IDS.length);
    }
  });
});
