const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { requireMember } = require('../lib/guard');
const { setMemberClaims, clearClaims } = require('../lib/claims');
const { writeAuditLog } = require('../lib/audit');
const { permissionExists } = require('../lib/permissions');

const VALID_STATUSES = ['active', 'suspended', 'terminated'];

/**
 * Suspend/reactivate/terminate. Setting status !== 'active' immediately cuts
 * off access at the claims level (Firestore rules check
 * request.auth.token.status == 'active' for almost everything), and we also
 * revoke the user's existing Firebase Auth refresh tokens so any session
 * they currently hold stops working the moment they next need a fresh ID
 * token — not just on their next explicit login.
 */
const setEmployeeStatus = onCall(async (request) => {
  const { companyId, db, uid: actorUid } = await requireMember(request, 'employees.edit');
  const { employeeUid, status } = request.data || {};
  if (!employeeUid || !VALID_STATUSES.includes(status)) {
    throw new HttpsError('invalid-argument', `status must be one of: ${VALID_STATUSES.join(', ')}.`);
  }

  const empRef = db.collection('companies').doc(companyId).collection('employees').doc(employeeUid);
  const empSnap = await empRef.get();
  if (!empSnap.exists) throw new HttpsError('not-found', 'Employee not found.');
  if (empSnap.data().isOwner) throw new HttpsError('permission-denied', 'The owner account is protected and cannot have its status changed this way.');

  await empRef.update({ status, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  if (status === 'active') {
    await setMemberClaims(employeeUid, { companyId, status: 'active' });
  } else {
    await setMemberClaims(employeeUid, { companyId, status });
    await admin.auth().revokeRefreshTokens(employeeUid);

    // Mark every session/device this person has as revoked too, so the
    // Devices/Sessions dashboards immediately reflect reality rather than
    // showing a "still active" device for someone who's been terminated.
    const batch = db.batch();
    const [sessions, devices] = await Promise.all([
      db.collection('companies').doc(companyId).collection('sessions').where('uid', '==', employeeUid).where('status', '==', 'active').get(),
      db.collection('companies').doc(companyId).collection('devices').where('uid', '==', employeeUid).where('status', '==', 'active').get(),
    ]);
    sessions.forEach(s => batch.update(s.ref, { status: 'revoked' }));
    devices.forEach(d => batch.update(d.ref, { status: 'revoked' }));
    await batch.commit();
  }

  await writeAuditLog(db, companyId, { actorUid, action: `Set employee status to ${status}`, target: employeeUid });
  return { ok: true };
});

/** Change an existing active employee's role. Same ownership protections as approval. */
const assignRole = onCall(async (request) => {
  const { companyId, db, uid: actorUid } = await requireMember(request, 'employees.assignRoles');
  const { employeeUid, roleId } = request.data || {};
  if (!employeeUid || !roleId) throw new HttpsError('invalid-argument', 'employeeUid and roleId are required.');

  const [empSnap, roleSnap] = await Promise.all([
    db.collection('companies').doc(companyId).collection('employees').doc(employeeUid).get(),
    db.collection('companies').doc(companyId).collection('roles').doc(roleId).get(),
  ]);
  if (!empSnap.exists) throw new HttpsError('not-found', 'Employee not found.');
  if (empSnap.data().isOwner) throw new HttpsError('permission-denied', 'Ownership cannot be changed through role assignment.');
  if (!roleSnap.exists || roleSnap.data().isOwner) throw new HttpsError('invalid-argument', 'Invalid target role.');

  await empSnap.ref.update({ roleId, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  await writeAuditLog(db, companyId, { actorUid, action: 'Changed employee role', target: employeeUid, metadata: `→ ${roleSnap.data().name}` });
  return { ok: true };
});

/** Per-employee "Additional permissions" / "Restricted permissions" (Section 9's custom-role escape hatch). */
const updateEmployeePermissionOverrides = onCall(async (request) => {
  const { companyId, db, uid: actorUid } = await requireMember(request, 'employees.assignRoles');
  const { employeeUid, additionalPermissions, restrictedPermissions } = request.data || {};
  if (!employeeUid) throw new HttpsError('invalid-argument', 'employeeUid is required.');

  for (const list of [additionalPermissions, restrictedPermissions]) {
    if (list && (!Array.isArray(list) || !list.every(permissionExists))) {
      throw new HttpsError('invalid-argument', 'One or more permission ids are not recognized.');
    }
  }

  const empRef = db.collection('companies').doc(companyId).collection('employees').doc(employeeUid);
  const empSnap = await empRef.get();
  if (!empSnap.exists) throw new HttpsError('not-found', 'Employee not found.');
  if (empSnap.data().isOwner) throw new HttpsError('permission-denied', "The owner's access cannot be restricted or supplemented.");

  const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (additionalPermissions) update.additionalPermissions = additionalPermissions;
  if (restrictedPermissions) update.restrictedPermissions = restrictedPermissions;
  await empRef.update(update);

  await writeAuditLog(db, companyId, { actorUid, action: 'Updated employee permission overrides', target: employeeUid });
  return { ok: true };
});

module.exports = { setEmployeeStatus, assignRole, updateEmployeePermissionOverrides };
