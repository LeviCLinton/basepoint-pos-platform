// The Cloud Functions equivalent of the Express backend's requirePermission
// middleware — one function every security-sensitive callable runs through
// first. Deliberately re-reads the employee's current role/permissions from
// Firestore rather than trusting the caller's ID token claims, because claims
// can be stale (see lib/claims.js) and because this is the one place in the
// whole system where "is this action actually allowed right now" gets
// decided — it needs the live answer, not a cached one.

const { HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { hasPermission } = require('./permissions');

/**
 * @param {import('firebase-functions/v2/https').CallableRequest} request
 * @param {string|null} requiredPermission - a permission id, or null to just require an active member
 * @returns {{ uid, companyId, employee, role }}
 */
async function requireMember(request, requiredPermission = null) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const uid = request.auth.uid;
  const companyId = request.data && request.data.companyId;
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required.');
  }

  const db = admin.firestore();
  const empSnap = await db.collection('companies').doc(companyId).collection('employees').doc(uid).get();
  if (!empSnap.exists) {
    // Deliberately the same error whether the company doesn't exist or the
    // user just isn't a member of it — don't leak which one.
    throw new HttpsError('permission-denied', 'You are not a member of this company.');
  }
  const employee = empSnap.data();
  if (employee.status !== 'active') {
    throw new HttpsError('permission-denied', `Your account is ${employee.status}.`);
  }

  let role = null;
  if (!employee.isOwner) {
    const roleSnap = await db.collection('companies').doc(companyId).collection('roles').doc(employee.roleId).get();
    role = roleSnap.exists ? roleSnap.data() : { permissions: [] };
  }

  if (requiredPermission) {
    const ok = hasPermission({
      isOwner: !!employee.isOwner,
      rolePermissions: role ? role.permissions : [],
      additionalPermissions: employee.additionalPermissions || [],
      restrictedPermissions: employee.restrictedPermissions || [],
    }, requiredPermission);
    if (!ok) {
      throw new HttpsError('permission-denied', 'You do not have permission to do that.', { required: requiredPermission });
    }
  }

  return { uid, companyId, employee, role, db };
}

module.exports = { requireMember };
