const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { requireMember } = require('../lib/guard');
const { writeAuditLog } = require('../lib/audit');

// Configurable per role, per Section 13 — not hard-coded to one number.
// A real deployment would likely move this onto the Role document itself
// (e.g. role.maxActiveSessions); kept as a simple map here to keep the
// vertical slice readable. Owner is intentionally unlimited by default.
const DEFAULT_MAX_SESSIONS = { Owner: Infinity, Manager: 2, Accountant: 2, Supervisor: 2, Cashier: 1 };

/**
 * Call this right after a successful client-side Firebase Auth sign-in.
 * Enforces the configurable max-concurrent-sessions rule from Section 13:
 * if the caller is already at their limit, this returns the list of their
 * other active sessions instead of silently creating a new one — the client
 * is expected to show "you're signed in elsewhere" and let the person pick
 * one to sign out, then retry.
 */
const recordLogin = onCall(async (request) => {
  const { companyId, db, uid, employee, role } = await requireMember(request);
  const { deviceId, forceTerminateSessionId } = request.data || {};
  if (!deviceId) throw new HttpsError('invalid-argument', 'deviceId is required.');

  const sessionsRef = db.collection('companies').doc(companyId).collection('sessions');
  const roleName = role ? role.name : 'Owner';
  const maxSessions = DEFAULT_MAX_SESSIONS[roleName] ?? 1;

  if (forceTerminateSessionId) {
    await sessionsRef.doc(forceTerminateSessionId).update({ status: 'revoked' });
  }

  const activeSnap = await sessionsRef.where('uid', '==', uid).where('status', '==', 'active').get();
  if (activeSnap.size >= maxSessions) {
    return {
      blocked: true,
      activeSessions: activeSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    };
  }

  const sessionRef = sessionsRef.doc();
  await sessionRef.set({
    uid, deviceId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: null,
    status: 'active',
  });

  await db.collection('companies').doc(companyId).collection('employees').doc(uid)
    .update({ lastLoginAt: admin.firestore.FieldValue.serverTimestamp() });

  await writeAuditLog(db, companyId, { actorUid: uid, action: 'Logged in', deviceId });
  return { blocked: false, sessionId: sessionRef.id };
});

const revokeSession = onCall(async (request) => {
  const { companyId, db, uid, employee } = await requireMember(request);
  const { sessionId } = request.data || {};
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId is required.');

  const sessionRef = db.collection('companies').doc(companyId).collection('sessions').doc(sessionId);
  const snap = await sessionRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Session not found.');

  if (snap.data().uid !== uid) {
    const { hasPermission } = require('../lib/permissions');
    const roleSnap = employee.isOwner ? null : await db.collection('companies').doc(companyId).collection('roles').doc(employee.roleId).get();
    const ok = hasPermission({
      isOwner: employee.isOwner,
      rolePermissions: roleSnap ? roleSnap.data().permissions : [],
      additionalPermissions: employee.additionalPermissions || [],
      restrictedPermissions: employee.restrictedPermissions || [],
    }, 'devices.manage');
    if (!ok) throw new HttpsError('permission-denied', 'You do not have permission to revoke another user\u2019s session.');
  }

  await sessionRef.update({ status: 'revoked' });
  await writeAuditLog(db, companyId, { actorUid: uid, action: 'Revoked session', target: sessionId });
  return { ok: true };
});

module.exports = { recordLogin, revokeSession };
