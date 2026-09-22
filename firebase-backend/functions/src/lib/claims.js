// Custom claims are how Firestore Security Rules cheaply know "which company
// is this user in, and are they active" without a document read on every
// single request. Kept deliberately tiny (claims have a hard 1000-byte total
// limit) — role and permissions are NOT in here, they're looked up from
// Firestore inside the rules themselves. See firestore.rules for why.
//
// IMPORTANT GOTCHA (this will bite you if you don't know it going in):
// setCustomUserClaims() updates the claims Firebase stores, but an already
// signed-in client's ID token is NOT updated until it refreshes. The Admin
// SDK can't force that. Two ways to handle it, both needed in practice:
//   1. Client-side: call `getIdToken(true)` (force refresh) right after any
//      action that might have changed your own claims (e.g. after being
//      approved, or after your role changes) — or listen for it and prompt
//      a re-login.
//   2. Server-side belt-and-suspenders: sensitive Cloud Functions here don't
//      trust claims alone for anything higher-stakes than "which company" —
//      they re-read the employee doc from Firestore for the actual
//      permission decision, since that's always current. Only the Firestore
//      Rules (which can't easily afford a client-triggered refresh) rely on
//      claims for the cheap company/status gate.

const admin = require('firebase-admin');

async function setMemberClaims(uid, { companyId, status }) {
  await admin.auth().setCustomUserClaims(uid, { companyId, status });
}

async function clearClaims(uid) {
  await admin.auth().setCustomUserClaims(uid, null);
}

module.exports = { setMemberClaims, clearClaims };
