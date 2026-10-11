# Remove the Admin table; block admins from the mobile login

## Problem

Admin accounts can sign in to the mobile app. The admin dashboard and the
mobile app share `POST /auth/login`, and only the dashboard's frontend
(`cordova-riskq-admin/src/hooks/useAuth.tsx`) checks the role — the backend
accepts any valid credentials.

Separately, the `Admin` table is dead: it was added in `68e4460` but nothing
reads it. Admins are `User` rows with `role = "admin"`, which is what every
check uses (`requireAdmin`, `requireResponderOrAdmin`, the socket `admin`
room, `createForAllAdmins`). The only reference is `prisma/seed.ts`, which
seeds a `super_admin` into `Admin` — an account that cannot log in.

## Decisions

- Admins stay in the `User` table with `role = "admin"`. The `Admin` table is
  dropped.
- Admins sign in only through a dedicated `POST /admin/auth/login`.
- `/auth/login` and `/auth/google` (the mobile app's logins) refuse admin
  accounts.

## Changes

### 1. Database

New migration `prisma/migrations/<timestamp>_drop_admin_table/migration.sql`:

```sql
DROP TABLE "Admin";

-- Revoke every existing admin session, including any open in the mobile
-- app; admins sign in again through the dashboard.
UPDATE "User" SET "tokenVersion" = "tokenVersion" + 1 WHERE "role" = 'admin';
```

Remove `model Admin` from `prisma/schema.prisma`.

### 2. Seed (`prisma/seed.ts`)

`seedAdmin()` upserts into `User` instead of `Admin`:
`create: { email, password: hashedPassword, name, role: "admin" }`,
`update: {}` (unchanged behavior: never overwrites an existing row). It keeps
the same env vars (`ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD`,
`ADMIN_SEED_NAME`) and still refuses to run without `ADMIN_SEED_PASSWORD`.

### 3. Mobile logins refuse admins (`src/services/auth.service.ts`)

- `login()`: after the password matches, if `user.role === "admin"`, throw
  `AppError("Admin accounts can only sign in through the admin dashboard.", 403)`.
  The check runs after the password check so it reveals nothing to someone
  without the password.
- `loginWithGoogle()`: if the Google email resolves to an existing user with
  `role === "admin"`, throw the same 403 before issuing a token.

### 4. Admin login: `POST /admin/auth/login`

- Route in `src/routes/admin.routes.ts` (before the authenticated routes),
  using `loginLimiter` and `validate(loginSchema)`.
- Service method `authService.adminLogin(email, password)`. The email lookup
  and password comparison are extracted from `login()` into one shared helper
  so both logins use the same credential check.
- A valid non-admin account gets `AppError("Invalid email or password", 401)` —
  the same message as wrong credentials, so the endpoint does not reveal which
  emails exist or what role they have.
- Response shape matches `/auth/login`: `{ user: { id, email, name, role, isOnDuty }, token }`.

### 5. Admin dashboard (`CordovaRiskQ- Admin/cordova-riskq-admin`)

`src/hooks/useAuth.tsx`: `login()` calls `"/admin/auth/login"` instead of
`"/auth/login"`. The existing client-side role check stays as
defense-in-depth.

## Testing

Unit tests (with the existing route-test pattern, e.g.
`src/routes/passwordReset.routes.test.ts`):

- `/auth/login` with admin credentials → 403 with the dashboard message.
- `/auth/login` with a wrong password for an admin → 401 (no role leak).
- `/auth/google` for an admin's email → 403.
- `/admin/auth/login` with admin credentials → 200 with a token.
- `/admin/auth/login` with citizen or responder credentials → 401
  "Invalid email or password".
- Citizen and responder `/auth/login` still succeed.

Manual: `npx prisma migrate dev`, `npx prisma db seed`, sign in to the
dashboard with the seeded admin, then confirm the same credentials are refused
in the mobile app.

## Out of scope

- Forgot-password / change-password for admins via the mobile app. These do
  not create a session.
- A `super_admin` role. Nothing checks it.
