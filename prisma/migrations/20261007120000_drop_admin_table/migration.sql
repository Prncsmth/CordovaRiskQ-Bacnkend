-- The Admin table was never read: admins are User rows with role 'admin'.
DROP TABLE "Admin";

-- Admins may no longer use the mobile app login. Bumping tokenVersion
-- revokes every existing admin session, including any open in the mobile
-- app; admins sign in again through the dashboard's /admin/auth/login.
UPDATE "User" SET "tokenVersion" = "tokenVersion" + 1 WHERE "role" = 'admin';
