// These tests mock the Firestore reads guard.js performs, so they run
// entirely offline — no emulator, no live project. They verify the actual
// decision logic (who gets past the gate and why), which is the part of
// this backend most worth being paranoid about. What they do NOT verify is
// that Firestore Security Rules independently enforce the same thing if a
// client bypasses Cloud Functions and hits Firestore directly — that
// requires the emulator + @firebase/rules-unit-testing, which needs
// binaries this environment can't download. See README.md.

function makeFakeDb(docs) {
  // docs: { "companies/c1/employees/u1": {...data} | null, ... }
  const docRef = (path) => ({
    get: async () => ({
      exists: docs[path] !== undefined && docs[path] !== null,
      data: () => docs[path],
    }),
  });
  const collection = (base) => ({
    doc: (id) => {
      const path = `${base}/${id}`;
      return {
        ...docRef(path),
        collection: (sub) => collection(`${path}/${sub}`),
      };
    },
  });
  return { collection: (name) => collection(name) };
}

jest.mock('firebase-admin', () => ({
  firestore: jest.fn(),
}));
const admin = require('firebase-admin');
const { requireMember } = require('../src/lib/guard');
const { SYSTEM_ROLE_DEFAULTS } = require('../src/lib/permissions');

function setupDb(docs) {
  admin.firestore.mockReturnValue(makeFakeDb(docs));
}

describe('requireMember', () => {
  test('rejects when not authenticated', async () => {
    await expect(requireMember({ auth: null, data: { companyId: 'c1' } }))
      .rejects.toThrow(/signed in/i);
  });

  test('rejects when companyId is missing from the request', async () => {
    await expect(requireMember({ auth: { uid: 'u1' }, data: {} }))
      .rejects.toThrow(/companyId/i);
  });

  test('rejects a user with no membership document in that company (no leak of which reason)', async () => {
    setupDb({}); // no employee doc at all
    await expect(requireMember({ auth: { uid: 'stranger' }, data: { companyId: 'c1' } }))
      .rejects.toThrow(/not a member/i);
  });

  test('rejects a suspended member even though their doc exists', async () => {
    setupDb({ 'companies/c1/employees/u1': { status: 'suspended', isOwner: false, roleId: 'r1' } });
    await expect(requireMember({ auth: { uid: 'u1' }, data: { companyId: 'c1' } }))
      .rejects.toThrow(/suspended/i);
  });

  test('allows an active member through with no required permission', async () => {
    setupDb({ 'companies/c1/employees/u1': { status: 'active', isOwner: false, roleId: 'r1' },
              'companies/c1/roles/r1': { permissions: [] } });
    const result = await requireMember({ auth: { uid: 'u1' }, data: { companyId: 'c1' } });
    expect(result.uid).toBe('u1');
    expect(result.companyId).toBe('c1');
  });

  test('rejects an active Cashier attempting an action requiring employees.delete', async () => {
    setupDb({
      'companies/c1/employees/u1': { status: 'active', isOwner: false, roleId: 'r1' },
      'companies/c1/roles/r1': { permissions: SYSTEM_ROLE_DEFAULTS.Cashier.permissions },
    });
    await expect(requireMember({ auth: { uid: 'u1' }, data: { companyId: 'c1' } }, 'employees.delete'))
      .rejects.toThrow(/permission/i);
  });

  test('allows the Owner through any permission check without a role lookup at all', async () => {
    setupDb({ 'companies/c1/employees/owner1': { status: 'active', isOwner: true, roleId: null } });
    const result = await requireMember({ auth: { uid: 'owner1' }, data: { companyId: 'c1' } }, 'subscription.manage');
    expect(result.employee.isOwner).toBe(true);
  });

  test('a suspended user cannot slip through even when a permission is also required', async () => {
    setupDb({
      'companies/c1/employees/u1': { status: 'suspended', isOwner: false, roleId: 'r1' },
      'companies/c1/roles/r1': { permissions: SYSTEM_ROLE_DEFAULTS.Manager.permissions },
    });
    await expect(requireMember({ auth: { uid: 'u1' }, data: { companyId: 'c1' } }, 'pos.view'))
      .rejects.toThrow(/suspended/i);
  });
});
