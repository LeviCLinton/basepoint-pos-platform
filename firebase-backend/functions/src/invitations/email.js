const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { requireMember } = require('../lib/guard');
const { writeAuditLog } = require('../lib/audit');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Admin invites a specific email address, optionally pre-selecting a role.
 * The token is generated here, hashed before storage (so a Firestore read of
 * the invitations collection — which no client can do anyway, see rules —
 * still wouldn't hand out a usable token), and the raw token is returned
 * ONCE to the caller to put in the email it sends (via your email provider
 * of choice; sending the actual email is outside this function's job).
 */
const createEmailInvitation = onCall(async (request) => {
  const { companyId, db, uid } = await requireMember(request, 'employees.create');
  const { email, roleId } = request.data || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw new HttpsError('invalid-argument', 'A valid email is required.');
  }

  if (roleId) {
    const roleSnap = await db.collection('companies').doc(companyId).collection('roles').doc(roleId).get();
    if (!roleSnap.exists || roleSnap.data().isOwner) {
      throw new HttpsError('invalid-argument', 'Invalid intended role.');
    }
  }

  const token = crypto.randomBytes(24).toString('hex');
  const inviteRef = db.collection('companies').doc(companyId).collection('invitations').doc();
  await inviteRef.set({
    email: email.toLowerCase().trim(),
    invitedBy: uid,
    intendedRoleId: roleId || null,
    status: 'pending',
    tokenHash: hashToken(token),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
  });

  await writeAuditLog(db, companyId, { actorUid: uid, action: 'Sent email invitation', target: email });

  // The caller (your onboarding UI / a follow-up Cloud Function wired to your
  // email provider) is responsible for actually emailing this link — e.g.
  // `https://yourapp.com/join?invite=${inviteRef.id}.${token}`.
  return { invitationId: inviteRef.id, token };
});

/**
 * The invited person, now signed in with their own Firebase Auth account,
 * redeems the token from the link they received. Single-use: status flips to
 * 'accepted' in the same transaction that creates the pending membership, so
 * a replayed link can never create a second request.
 */
const acceptEmailInvitation = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { companyId, invitationId, token } = request.data || {};
  if (!companyId || !invitationId || !token) {
    throw new HttpsError('invalid-argument', 'companyId, invitationId, and token are all required.');
  }

  const db = admin.firestore();
  const uid = request.auth.uid;
  const inviteRef = db.collection('companies').doc(companyId).collection('invitations').doc(invitationId);

  await db.runTransaction(async (t) => {
    const snap = await t.get(inviteRef);
    if (!snap.exists) throw new HttpsError('not-found', 'This invitation link is not valid.');
    const invite = snap.data();

    if (invite.status !== 'pending') throw new HttpsError('failed-precondition', 'This invitation has already been used or revoked.');
    if (invite.expiresAt.toDate() < new Date()) throw new HttpsError('failed-precondition', 'This invitation has expired.');
    if (hashToken(token) !== invite.tokenHash) throw new HttpsError('permission-denied', 'This invitation link is not valid.');
    if (invite.email && request.auth.token.email && invite.email !== request.auth.token.email.toLowerCase()) {
      throw new HttpsError('permission-denied', 'This invitation was sent to a different email address.');
    }

    const employeeRef = db.collection('companies').doc(companyId).collection('employees').doc(uid);
    t.set(employeeRef, {
      uid, name: request.auth.token.name || '', email: request.auth.token.email || invite.email, phone: null,
      roleId: null, isOwner: false, departmentId: null,
      status: 'pending', employeeId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      invitedBy: invite.invitedBy, approvedBy: null, approvedAt: null,
      lastLoginAt: null, lastActiveAt: null,
      additionalPermissions: [], restrictedPermissions: [],
      branchIds: [],
      joinMethod: 'email',
      intendedRoleId: invite.intendedRoleId || null,
    });
    t.update(inviteRef, { status: 'accepted', acceptedAt: admin.firestore.FieldValue.serverTimestamp(), acceptedBy: uid });
  });

  await writeAuditLog(db, companyId, { actorUid: uid, action: 'Accepted email invitation' });
  return { status: 'pending', companyId };
});

module.exports = { createEmailInvitation, acceptEmailInvitation };
