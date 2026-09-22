// The ONLY way an audit log entry is ever written — Firestore rules deny all
// client writes to auditLogs (see firestore.rules), so this Admin-SDK path,
// used exclusively from inside Cloud Functions, is the sole writer. That's
// what "immutable" means here: there's no client code path that can create,
// edit, or delete one.

const admin = require('firebase-admin');

async function writeAuditLog(db, companyId, { actorUid, action, target = '', metadata = '', deviceId = null }) {
  await db.collection('companies').doc(companyId).collection('auditLogs').add({
    actorUid, action, target, metadata, deviceId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

module.exports = { writeAuditLog };
