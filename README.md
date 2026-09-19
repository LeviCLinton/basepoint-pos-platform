# Basepoint — Firebase Multi-Tenant Backend

A production-oriented Firebase backend for multi-tenant POS: company registration,
employee onboarding (invite code/QR, email, email-domain matching), role-based
access control with per-employee overrides, device licensing, session management,
and immutable audit logging.

**Read "What I could and couldn't verify" below before deploying this anywhere near
real data.** This was built and tested without a live Firebase project or the
emulator suite — both were unreachable from the sandbox this was built in. The
business logic is genuinely tested; the Firestore Security Rules are carefully
written and reasoned through, but not fired against a real database. Verify them
yourself (instructions below) before trusting them with a real customer's data.

---

## What's actually built

| Phase (per spec) | Status |
|---|---|
| 1 — Firebase foundation (Auth, Firestore structure, App Check) | ✅ Structure + App Check enforcement wired |
| 2 — Company registration | ✅ `registerCompany` |
| 3 — Employee onboarding (code/QR, email, domain) | ✅ All three join methods |
| 4 — RBAC (roles, granular permissions) | ✅ Full permission catalog + role CRUD via rules |
| 5 — Employee management (approve/reject/suspend/role changes) | ✅ |
| 6 — Device management (registration, limits, revocation) | ✅ |
| 7 — Session management (concurrent session limits, revocation) | ✅ |
| 8 — Audit logging | ✅ Write-only-from-server, immutable by rule |
| 9 — Applying tenant isolation to existing POS modules | ⚠️ Rules written for products/sales/customers/suppliers/expenses/orders/settings/branches; **actual sale creation with transactional stock deduction is not yet a Cloud Function** — see "What's next" |
| 10 — Security testing & hardening | ⚠️ Logic unit-tested; rules NOT fired against a live/emulated database — see below |
| Multi-branch readiness (Section 21) | ✅ Data model supports it (`branchIds` on employees, a `branches` subcollection + rule); no branch-scoped query logic built yet |
| Domain spoofing protection (Section 6) | ✅ Matching a domain only surfaces the company and requires an explicit follow-up request — never auto-grants |
| FCM / Storage / Hosting | ❌ Not built — nothing in this slice needed them yet |

---

## What I could and couldn't verify — please read this

**Verified, for real, in this sandbox:**
- `functions/test/permissions.test.js` (10 tests) — the permission-resolution logic itself: role permissions, additional grants, restrictions overriding grants, Owner bypass, and a sanity check that no non-owner role accidentally gets every permission.
- `functions/test/guard.test.js` (9 tests) — the `requireMember()` gate every Cloud Function runs through: rejects unauthenticated calls, rejects non-members without leaking whether the company exists, rejects suspended accounts even when they'd otherwise have the right permission, and correctly lets Owners through without a role lookup.
- All 17 Cloud Functions `require()` successfully with no syntax or import errors.

Run these yourself: `cd functions && npm install && npm test`.

**NOT verified, and why:**
- **Firestore Security Rules** (`firestore.rules`) — the actual enforcement boundary — were never fired against a database. Testing them properly means `firebase emulators:start` plus the `@firebase/rules-unit-testing` package, and the emulator binary downloads from `storage.googleapis.com`, which this sandbox cannot reach (confirmed — I tried; it fails with a 403 from the network policy here, not a issue with the rules or the command). **You should run this yourself before trusting the rules**:
  ```bash
  npm install -g firebase-tools
  cd firebase-backend
  firebase emulators:start
  # in another terminal, with @firebase/rules-unit-testing installed:
  # write tests asserting a Company-A cashier token cannot read Company-B's
  # products, cannot approve their own membership, etc. — Section 25 of the
  # spec lists exactly the scenarios to cover.
  ```
- **Real end-to-end flows** (actual Firebase Auth accounts, actual Firestore writes, actual App Check tokens) — same reason. The Express/Postgres backend built earlier in this project *was* verified this way (real curl requests, real cross-tenant attack attempts, real 404s); holding this to a lower bar than that would be dishonest, so I'm flagging it loudly instead.
- **Cost and quota behavior at scale** — Firestore's per-request `get()` calls inside `hasPermission()` (two reads per permission check: the employee doc, then the role doc) work correctly but add real read costs under load. Fine for a vertical slice; worth revisiting with caching (e.g. denormalizing a role's permission array onto the employee doc, invalidated on role change) before high-traffic production use.

---

## ⚠️ The question this doesn't answer for you

**This is a second, parallel backend implementation of almost the same problem the Express/Postgres backend (built earlier in this project) already solves** — multi-tenant POS, RBAC, employee lifecycle, audit logging. You now have two architectures:

| | Express + Postgres | Firebase |
|---|---|---|
| Hosting | You choose (Render/Railway/Fly/your own) | Locked to Google Cloud |
| Database | Postgres — SQL, joins, migrations you control | Firestore — NoSQL, denormalized, different mental model |
| Auth | You own it (bcrypt + JWT here; swappable) | Firebase Authentication (managed, less code, less control) |
| Realtime sync | Not built | Native (Firestore listeners) — genuinely valuable for a POS with multiple registers |
| Vendor lock-in | Low | Higher (Firestore's query limits and pricing model are Google-specific) |
| Cost model | Predictable (server + DB hosting) | Pay-per-read/write — can surprise you at scale if not watched |
| What's tested | Real, live, curl-verified (previous turn) | Logic-tested only, rules unverified (this turn) |

**Running both in production for the same product doesn't make sense.** Pick one before going further. If you want my honest read: Firestore's realtime sync is a genuine, meaningful advantage for a multi-register POS (stock updates propagating to every till instantly, no polling) — that's the strongest reason to choose Firebase here. The strongest reason to stick with Express/Postgres is that it's the one that's actually been proven against live attack attempts so far, and SQL gives you real transactions and joins that Firestore's model makes more awkward (see the sales/stock-deduction gap below).

I built what was asked for phase-by-phase, as instructed — but I'm not going to pretend this doesn't create a fork you need to resolve.

---

## Architecture notes worth knowing

**Custom claims are deliberately minimal.** `request.auth.token` carries only `{ companyId, status }` — not role or permissions. Claims have a hard 1000-byte limit, and a role's permission list can be long. Role/permission checks happen via `get()` lookups inside the Security Rules themselves and via direct Firestore reads inside Cloud Functions (`src/lib/guard.js`). The trade-off: slightly more reads per request, but permission changes take effect immediately without needing every affected user to get a fresh ID token.

**Claims DO need a refresh after status changes**, though — `companyId`/`status` changes (approval, suspension) don't reach an already-open client session until it calls `getIdToken(true)`. Build this into your client: after any action that might change your own standing (being approved, being suspended), force a token refresh or prompt re-login. `src/lib/claims.js` has the full explanation inline.

**Sale creation is intentionally left more open than everything else** (`firestore.rules`, the `sales` collection: `allow create: if hasPermission(...)` with no Cloud Function requirement). Section 15 of the spec calls for sales to go through a Cloud Function so stock deduction and price calculation happen transactionally and server-side — exactly what the Express backend's `src/routes/sales.js` already does correctly (row-locked transaction, server-recomputed price). Porting that same logic to a `createSale` Cloud Function using `db.runTransaction()` is the single most important piece of unfinished work here — right now a compromised or buggy client could write an inconsistent sale directly to Firestore. Flagged clearly rather than silently left as a gap.

**Owner protection is enforced in three independent places** (Cloud Functions reject it, Security Rules reject editing/deleting the Owner role, and `approveEmployee`/`assignRole` explicitly refuse to grant `isOwner`) — deliberately redundant, since this is the one privilege-escalation path that must never work.

---

## Project structure

```
firebase-backend/
  firebase.json              — emulator ports, functions + rules config
  firestore.rules            — the actual enforcement boundary (start here)
  firestore.indexes.json     — empty; every query here only needs Firestore's automatic single-field indexes
  functions/
    index.js                 — exports every callable function, sets up App Check enforcement
    src/
      lib/
        permissions.js       — permission catalog + role defaults (kept in sync with the frontend & Express backend by hand)
        guard.js              — requireMember(): the auth+permission gate every function uses
        claims.js             — custom claims helper + the token-refresh gotcha explained
        audit.js               — the only path that writes an audit log entry
      company/register.js     — registerCompany
      invitations/
        code.js               — regenerateInviteCode, setInviteCodeActive, joinWithCode
        email.js               — createEmailInvitation, acceptEmailInvitation
        domain.js               — requestAccessByDomain, requestToJoinCompany
      employees/
        approve.js             — approveEmployee, rejectEmployee
        status.js               — setEmployeeStatus (suspend/reactivate/terminate), assignRole, updateEmployeePermissionOverrides
      devices/register.js       — registerDevice (transactional limit check), revokeDevice
      sessions/record.js         — recordLogin (concurrent-session limit), revokeSession
    test/
      permissions.test.js        — pure logic tests (real, passing)
      guard.test.js                — auth-gate tests with mocked Firestore (real, passing)
```

---

## Setup

1. Create a real Firebase project at [console.firebase.google.com](https://console.firebase.google.com) if you don't have one.
2. `npm install -g firebase-tools && firebase login`
3. `firebase use --add` inside this directory, pick your project.
4. Enable in the console: Authentication (Email/Password provider at minimum), Firestore (production mode), App Check (register your app, choose reCAPTCHA v3 for web or Play Integrity/App Attest for mobile).
5. `cd functions && npm install`
6. Deploy: `firebase deploy --only functions,firestore:rules`
7. **Before pointing real users at it**, run the emulator and write the cross-tenant/privilege-escalation tests from Section 25 of the spec — see "What's next" below.

### Local development
```bash
firebase emulators:start
```
App Check enforcement is strict by default (`enforceAppCheck: true` in `index.js`) — for local emulator testing you'll want to either temporarily set that to `false` for local runs, or configure an App Check debug token (Firebase's documented mechanism for exactly this situation).

---

## What's next (in priority order)

1. **Write and run the Section 25 security tests against the emulator** — tenant isolation, privilege escalation, employee lifecycle, device limits. This repo gives you the rules and functions to test; it doesn't yet give you those specific test files, since I couldn't run them here to know they pass.
2. **Port sale creation into a transactional Cloud Function** (see "Architecture notes" above) — this is the biggest real gap between "looks right" and "is right."
3. **Resolve the Express-vs-Firebase fork** before building more on either.
4. **Wire actual email sending** for `createEmailInvitation` — it generates and hashes a token correctly but doesn't send anything; hook it to SendGrid/Postmark/Firebase Extensions' "Trigger Email" extension.
5. **Storage rules** for the optional business logo upload (Section 3) — not written yet.
6. **FCM** for admin approval/security-event notifications (Section 8, mentioned in the tech requirements) — not built.
