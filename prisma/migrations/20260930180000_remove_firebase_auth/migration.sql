-- Reverses 20260930120000_add_user_firebase_uid and
-- 20260930160000_pending_registration_firebase_otp: authentication is back
-- to our own email + password (bcrypt) accounts verified by a 6-digit email
-- code, with no Firebase Authentication.

-- 1. Remove the three Firebase-only TEST accounts created while testing the
--    Firebase flow (no password, no Google, no related rows -- verified
--    before this migration was applied). Matched by exact id AND the
--    Firebase-only criteria, so on any other database this deletes nothing.
DELETE FROM "User"
WHERE "id" IN (
    '624f3575-9672-4867-8f75-5469a936d0b7',
    'b4c364d2-f251-411e-9024-8d81808024e5',
    'f362c369-9ecc-4eb8-98b8-de30892b9fa6'
)
  AND "firebaseUid" IS NOT NULL
  AND "password" IS NULL
  AND "googleId" IS NULL;

-- 2. Pending registrations from the Firebase flow carry no password hash and
--    can never complete under the password flow; they are short-lived
--    one-time-code rows, not accounts.
DELETE FROM "PendingRegistration" WHERE "passwordHash" IS NULL;

-- 3. PendingRegistration: password hash required again, no Firebase UID.
DROP INDEX "PendingRegistration_firebaseUid_key";
ALTER TABLE "PendingRegistration" DROP COLUMN "firebaseUid",
ALTER COLUMN "passwordHash" SET NOT NULL;

-- 4. User: no Firebase UID.
DROP INDEX "User_firebaseUid_key";
ALTER TABLE "User" DROP COLUMN "firebaseUid";
