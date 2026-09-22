const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();

// App Check enforcement (Section 12/22): every onCall function below rejects
// requests that don't carry a valid App Check token, at the platform level,
// before any of our handler code runs. This has to also be turned on for
// each function's config in the Firebase Console / via `enforceAppCheck:
// true` per-function (v2 supports it as an option to onCall) — set globally
// here so nobody has to remember it per-file. During local development
// against the emulator, App Check enforcement is typically relaxed via the
// emulator's debug token mechanism; see README.md.
setGlobalOptions({ enforceAppCheck: true, region: 'us-central1' });

const { registerCompany } = require('./src/company/register');
const { regenerateInviteCode, setInviteCodeActive, joinWithCode } = require('./src/invitations/code');
const { createEmailInvitation, acceptEmailInvitation } = require('./src/invitations/email');
const { requestAccessByDomain, requestToJoinCompany } = require('./src/invitations/domain');
const { approveEmployee, rejectEmployee } = require('./src/employees/approve');
const { setEmployeeStatus, assignRole, updateEmployeePermissionOverrides } = require('./src/employees/status');
const { registerDevice, revokeDevice } = require('./src/devices/register');
const { recordLogin, revokeSession } = require('./src/sessions/record');

module.exports = {
  registerCompany,
  regenerateInviteCode, setInviteCodeActive, joinWithCode,
  createEmailInvitation, acceptEmailInvitation,
  requestAccessByDomain, requestToJoinCompany,
  approveEmployee, rejectEmployee,
  setEmployeeStatus, assignRole, updateEmployeePermissionOverrides,
  registerDevice, revokeDevice,
  recordLogin, revokeSession,
};
