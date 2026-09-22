const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { requireMember } = require('../lib/guard');
const { writeAuditLog } = require('../lib/audit');

/**
 * Section 12 is explicit that a device shouldn't be trusted purely on the
 * strength of a client-generated string. What this function actually
 * enforces: a valid Firebase Auth session (requireMember already checked
 * that) plus App Check (enforced at the Functions-deployment level via
 * `enforceAppCheck: true` — see index.js — which rejects the request before
 * it even reaches this handler if the App Check token is missing/invalid).
 * The deviceId/fingerprint passed in request.data is metadata for the
 * dashboard, not a security boundary by itself.
 */
const registerDevice = onCall(async (request) => {
  const { companyId, db, uid } = await requireMember(request);
  const { deviceName, deviceType, os, appVersion, clientDeviceId } = request.data || {};
  if (!deviceName) throw new HttpsError('invalid-argument', 'deviceName is required.');

  const companyRef = db.collection('companies').doc(companyId);
  const devicesRef = companyRef.collection('devices');

  const result = await db.runTransaction(async (t) => {
    const companySnap = await t.get(companyRef);
    const limit = companySnap.data().subscription?.deviceLimit ?? Infinity;

    // Already-registered device (same client fingerprint) re-registering —
    // e.g. app reinstall — updates in place instead of consuming a new slot.
    let existingRef = null;
    if (clientDeviceId) {
      const existing = await t.get(devicesRef.where('clientDeviceId', '==', clientDeviceId).where('uid', '==', uid).limit(1));
      if (!existing.empty) existingRef = existing.docs[0].ref;
    }

    if (!existingRef) {
      const activeCountSnap = await t.get(devicesRef.where('status', '==', 'active'));
      if (activeCountSnap.size >= limit) {
        throw new HttpsError('resource-exhausted', `This company's plan allows up to ${limit} active devices. Ask an admin to revoke an unused one first.`, { limit, active: activeCountSnap.size });
      }
    }

    const ref = existingRef || devicesRef.doc();
    const payload = {
      uid, name: deviceName, type: deviceType || 'unknown', os: os || 'unknown', appVersion: appVersion || null,
      clientDeviceId: clientDeviceId || null,
      registeredAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'active',
    };
    t.set(ref, payload, { merge: true });
    return { deviceId: ref.id };
  });

  await writeAuditLog(db, companyId, { actorUid: uid, action: 'Registered device', target: result.deviceId, deviceId: result.deviceId, metadata: deviceName });
  return result;
});

const revokeDevice = onCall(async (request) => {
  const { companyId, db, uid, employee } = await requireMember(request);
  const { deviceId } = request.data || {};
  if (!deviceId) throw new HttpsError('invalid-argument', 'deviceId is required.');

  const deviceRef = db.collection('companies').doc(companyId).collection('devices').doc(deviceId);
  const snap = await deviceRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Device not found.');

  const isOwnDevice = snap.data().uid === uid;
  if (!isOwnDevice) {
    // Revoking someone else's device requires devices.manage — re-check
    // explicitly since requireMember() above was called without a required
    // permission (self-revocation needs none).
    const { hasPermission } = require('../lib/permissions');
    const roleSnap = employee.isOwner ? null : await db.collection('companies').doc(companyId).collection('roles').doc(employee.roleId).get();
    const ok = hasPermission({
      isOwner: employee.isOwner,
      rolePermissions: roleSnap ? roleSnap.data().permissions : [],
      additionalPermissions: employee.additionalPermissions || [],
      restrictedPermissions: employee.restrictedPermissions || [],
    }, 'devices.manage');
    if (!ok) throw new HttpsError('permission-denied', 'You do not have permission to revoke another user\u2019s device.');
  }

  await deviceRef.update({ status: 'revoked' });
  await writeAuditLog(db, companyId, { actorUid: uid, action: 'Revoked device', target: deviceId, deviceId });
  return { ok: true };
});

module.exports = { registerDevice, revokeDevice };
