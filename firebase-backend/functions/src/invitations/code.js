const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { requireMember } = require('../lib/guard');
const { writeAuditLog } = require('../lib/audit');

/** Owner/admin regenerates the shared join code (invalidates the old one, and any QR built from it). */
const regenerateInviteCode = onCall(async (request) => {
  const { companyId, db, uid } = await requireMember(request, 'employees.assignRoles');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(crypto.randomBytes(8)).map(b => alphabet[b % alphabet.length]).join('');

  await db.collection('companies').doc(companyId).update({
    'inviteCode.code': code, 'inviteCode.active': true,
  });
  await writeAuditLog(db, companyId, { actorUid: uid, action: 'Regenerated invite code' });
  return { code };
});

const setInviteCodeActive = onCall(async (request) => {
  const { companyId, db, uid } = await requireMember(request, 'employees.assignRoles');
  const active = !!(request.data && request.data.active);
  await db.collection('companies').doc(companyId).update({ 'inviteCode.active': active });
  await writeAuditLog(db, companyId, { actorUid: uid, action: active ? 'Enabled invite code' : 'Disabled invite code' });
  return { ok: true };
});

/**
 * Section 4, Method A: an employee who already has a Firebase Auth account
 * calls this with the code they typed or scanned. Creates a PENDING
 * membership — never active, never role-assigned — an owner/admin must
 * approve it via approveEmployee before the account can do anything. This is
 * the specific mechanism that makes "employee cannot self-promote" true: the
 * only role this function is capable of assigning is nothing at all.
 */
const joinWithCode = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { code } = request.data || {};
  if (!code || typeof code !== 'string') throw new HttpsError('invalid-argument', 'A company code is required.');

  const db = admin.firestore();
  const uid = request.auth.uid;

  const matches = await db.collection('companies').where('inviteCode.code', '==', code.toUpperCase().trim()).limit(1).get();
  if (matches.empty) throw new HttpsError('not-found', 'That company code was not recognized.');

  const companyDoc = matches.docs[0];
  const company = companyDoc.data();
  if (!company.inviteCode.active) throw new HttpsError('failed-precondition', 'This company code has been disabled.');
  if (company.inviteCode.expiresAt && company.inviteCode.expiresAt.toDate() < new Date()) {
    throw new HttpsError('failed-precondition', 'This company code has expired.');
  }

  const employeeRef = companyDoc.ref.collection('employees').doc(uid);
  const existing = await employeeRef.get();
  if (existing.exists) {
    const status = existing.data().status;
    if (status === 'active') throw new HttpsError('already-exists', 'You already belong to this company.');
    if (status === 'pending') return { status: 'pending', companyId: companyDoc.id }; // idempotent re-submit
  }

  // Employee count check against the subscription limit happens here too —
  // pending requests still reserve a slot so an owner can't be surprised by
  // a flood of approvals that blow past the plan limit.
  const employeeCountSnap = await companyDoc.ref.collection('employees')
    .where('status', 'in', ['active', 'pending']).count().get();
  if (employeeCountSnap.data().count >= (company.subscription?.employeeLimit ?? Infinity)) {
    throw new HttpsError('resource-exhausted', 'This company has reached its employee limit for its current plan.');
  }

  await employeeRef.set({
    uid, name: request.auth.token.name || '', email: request.auth.token.email || null, phone: null,
    roleId: null, isOwner: false, departmentId: null,
    status: 'pending', employeeId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    invitedBy: null, approvedBy: null, approvedAt: null,
    lastLoginAt: null, lastActiveAt: null,
    additionalPermissions: [], restrictedPermissions: [],
    branchIds: [],
    joinMethod: 'code',
  });

  await writeAuditLog(db, companyDoc.id, { actorUid: uid, action: 'Requested to join via company code' });
  return { status: 'pending', companyId: companyDoc.id };
});

module.exports = { regenerateInviteCode, setInviteCodeActive, joinWithCode };
