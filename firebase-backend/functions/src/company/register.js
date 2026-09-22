const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { SYSTEM_ROLE_DEFAULTS } = require('../lib/permissions');
const { setMemberClaims } = require('../lib/claims');
const { writeAuditLog } = require('../lib/audit');

function generateInviteCode() {
  // Short, human-typeable, still hard to guess: 8 chars from an unambiguous
  // alphabet (no 0/O/1/I confusion).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8)).map(b => alphabet[b % alphabet.length]).join('');
}

/**
 * Creates a company + its Owner account in one atomic batch. This is THE
 * entry point for Section 3 of the spec — everything it does (companyId
 * generation, role seeding, owner assignment) happens server-side so a
 * client can never forge a companyId or hand itself the Owner role directly.
 *
 * The Firebase Auth *account* itself must already exist by the time this is
 * called (create it client-side with createUserWithEmailAndPassword first,
 * then call this function while signed in as that new user) — that keeps
 * password handling entirely inside Firebase Auth, never touching our code.
 */
const registerCompany = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Create your account first, then register the business while signed in.');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const required = ['businessName', 'ownerName'];
  for (const field of required) {
    if (!data[field] || typeof data[field] !== 'string') {
      throw new HttpsError('invalid-argument', `${field} is required.`);
    }
  }

  const db = admin.firestore();
  const companyRef = db.collection('companies').doc(); // server-generated id — never client-supplied
  const companyId = companyRef.id;

  const batch = db.batch();

  batch.set(companyRef, {
    name: data.businessName,
    ownerUid: uid,
    type: data.businessType || 'retail',
    country: data.country || '',
    currency: data.currency || 'USD',
    logoUrl: data.logoUrl || null,
    address: data.address || null,
    phone: data.phone || null,
    email: request.auth.token.email || null,
    taxRate: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    inviteCode: { code: generateInviteCode(), active: true, expiresAt: null },
    subscription: {
      plan: 'trial',
      deviceLimit: 3,
      employeeLimit: 5,
      branchLimit: 1,
      features: {},
    },
  });

  const roleIds = {};
  for (const [name, def] of Object.entries(SYSTEM_ROLE_DEFAULTS)) {
    const roleRef = companyRef.collection('roles').doc();
    roleIds[name] = roleRef.id;
    batch.set(roleRef, {
      name, description: def.description, isSystem: true,
      isOwner: !!def.isOwner, active: true, permissions: def.permissions,
    });
  }

  const employeeRef = companyRef.collection('employees').doc(uid);
  batch.set(employeeRef, {
    uid, name: data.ownerName, email: request.auth.token.email || null, phone: data.phone || null,
    roleId: roleIds.Owner, isOwner: true, departmentId: null,
    status: 'active', employeeId: 'EMP-001',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    invitedBy: null, approvedBy: null, approvedAt: null,
    lastLoginAt: null, lastActiveAt: null,
    additionalPermissions: [], restrictedPermissions: [],
    branchIds: 'all',
  });

  await batch.commit();
  await setMemberClaims(uid, { companyId, status: 'active' });
  await writeAuditLog(db, companyId, { actorUid: uid, action: 'Company registered', target: data.businessName });

  return { companyId, inviteCode: (await companyRef.get()).data().inviteCode.code };
});

module.exports = { registerCompany };
