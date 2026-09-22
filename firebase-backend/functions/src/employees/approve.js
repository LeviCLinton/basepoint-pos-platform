const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { requireMember } = require('../lib/guard');
const { setMemberClaims } = require('../lib/claims');
const { writeAuditLog } = require('../lib/audit');

/**
 * The ONLY place a pending membership becomes active and gets a real role.
 * This is what makes "an employee can never promote themselves" true in
 * practice: joinWithCode/acceptEmailInvitation can only ever create a
 * roleId: null, status: 'pending' document — turning that into an active,
 * role-bearing account requires someone who already holds
 * employees.assignRoles to call this, explicitly, naming the role.
 */
const approveEmployee = onCall(async (request) => {
  const { companyId, db, uid: approverUid } = await requireMember(request, 'employees.assignRoles');
  const { employeeUid, roleId, departmentId, employeeId } = request.data || {};
  if (!employeeUid || !roleId) throw new HttpsError('invalid-argument', 'employeeUid and roleId are required.');

  const roleSnap = await db.collection('companies').doc(companyId).collection('roles').doc(roleId).get();
  if (!roleSnap.exists) throw new HttpsError('invalid-argument', 'Invalid role.');
  if (roleSnap.data().isOwner) {
    throw new HttpsError('permission-denied', 'Ownership cannot be granted through employee approval — use a dedicated ownership-transfer flow.');
  }

  const empRef = db.collection('companies').doc(companyId).collection('employees').doc(employeeUid);
  const empSnap = await empRef.get();
  if (!empSnap.exists) throw new HttpsError('not-found', 'Membership request not found.');
  if (empSnap.data().status !== 'pending') throw new HttpsError('failed-precondition', 'This request is not pending.');

  await empRef.update({
    status: 'active', roleId, departmentId: departmentId || null,
    employeeId: employeeId || null,
    approvedBy: approverUid, approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await setMemberClaims(employeeUid, { companyId, status: 'active' });
  await writeAuditLog(db, companyId, { actorUid: approverUid, action: 'Approved employee', target: employeeUid, metadata: `role=${roleSnap.data().name}` });

  return { ok: true };
});

const rejectEmployee = onCall(async (request) => {
  const { companyId, db, uid: approverUid } = await requireMember(request, 'employees.assignRoles');
  const { employeeUid } = request.data || {};
  if (!employeeUid) throw new HttpsError('invalid-argument', 'employeeUid is required.');

  const empRef = db.collection('companies').doc(companyId).collection('employees').doc(employeeUid);
  const empSnap = await empRef.get();
  if (!empSnap.exists) throw new HttpsError('not-found', 'Membership request not found.');

  await empRef.update({ status: 'rejected', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  await writeAuditLog(db, companyId, { actorUid: approverUid, action: 'Rejected employee request', target: employeeUid });
  return { ok: true };
});

module.exports = { approveEmployee, rejectEmployee };
