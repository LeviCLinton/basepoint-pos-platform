const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { writeAuditLog } = require('../lib/audit');

/**
 * Section 6: domain matching only ever SUGGESTS a company and creates a
 * pending request — it never grants access by itself. This deliberately
 * does not trust the client's claim of which company it wants; it looks up
 * companies by their configured `allowedDomains` array itself.
 */
const requestAccessByDomain = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const email = request.auth.token.email;
  if (!email) throw new HttpsError('failed-precondition', 'Your account has no email address to match against.');
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) throw new HttpsError('invalid-argument', 'Could not determine your email domain.');

  const db = admin.firestore();
  const matches = await db.collection('companies')
    .where('allowedDomains', 'array-contains', domain)
    .limit(5)
    .get();

  if (matches.empty) {
    return { matches: [] };
  }

  // Multiple companies could (in theory) share a domain claim; surface all
  // of them and let the person pick, rather than guessing.
  return {
    matches: matches.docs.map(d => ({ companyId: d.id, name: d.data().name })),
  };
});

/** Second step: having seen the match, the user explicitly asks to join a specific one of them. */
const requestToJoinCompany = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { companyId } = request.data || {};
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');

  const db = admin.firestore();
  const uid = request.auth.uid;
  const companyRef = db.collection('companies').doc(companyId);
  const companySnap = await companyRef.get();
  if (!companySnap.exists) throw new HttpsError('not-found', 'Company not found.');

  const email = request.auth.token.email;
  const domain = email ? email.split('@')[1]?.toLowerCase() : null;
  const allowedDomains = companySnap.data().allowedDomains || [];
  if (!domain || !allowedDomains.includes(domain)) {
    throw new HttpsError('permission-denied', 'Your email domain is not authorized for this company.');
  }

  const employeeRef = companyRef.collection('employees').doc(uid);
  const existing = await employeeRef.get();
  if (existing.exists && existing.data().status === 'active') {
    throw new HttpsError('already-exists', 'You already belong to this company.');
  }

  await employeeRef.set({
    uid, name: request.auth.token.name || '', email, phone: null,
    roleId: null, isOwner: false, departmentId: null,
    status: 'pending', employeeId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    invitedBy: null, approvedBy: null, approvedAt: null,
    lastLoginAt: null, lastActiveAt: null,
    additionalPermissions: [], restrictedPermissions: [],
    branchIds: [],
    joinMethod: 'domain',
  }, { merge: true });

  await writeAuditLog(db, companyId, { actorUid: uid, action: 'Requested access via matching email domain' });
  return { status: 'pending', companyId };
});

module.exports = { requestAccessByDomain, requestToJoinCompany };
