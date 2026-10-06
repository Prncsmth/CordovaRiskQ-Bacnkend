# Remove Admin Table / Block Admin Mobile Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin accounts (`User.role === "admin"`) can sign in only through a new `POST /api/admin/auth/login`; the mobile logins refuse them; the unused `Admin` table is dropped.

**Architecture:** A small pure guard (`assertPortalAllowed`) decides whether a role may use a login portal ("app" or "admin") and is unit-tested without a database. `auth.service.ts` shares one credential check between the mobile login and a new `adminLogin`, and calls the guard in both, plus in Google login before any account linking. A hand-written migration drops `Admin` and bumps admin `tokenVersion` to revoke existing admin sessions.

**Tech Stack:** Express 5 + TypeScript (tsx), Prisma (PostgreSQL / Neon), zod, `node:test` + `node:assert/strict`. Admin dashboard: Next.js.

**Spec:** `docs/superpowers/specs/2026-10-07-remove-admin-table-design.md`

## Global Constraints

- Mobile refusal message, exactly: `Admin accounts can only sign in through the admin dashboard.` with status **403**.
- Admin endpoint refusal for a non-admin, exactly: `Invalid email or password` with status **401**.
- `/admin/auth/login` uses the existing `loginLimiter` and `validate(loginSchema)`.
- Response shape of `/admin/auth/login` matches `/auth/login`: `{ success: true, user: { id, email, name, role, isOnDuty }, token }`.
- Tests run with `npm test` (`tsx --test src/**/*.test.ts`); tests must not need a database.
- Code style: 4-space indent, double quotes, `@/` imports, comments explain *why*.

---

## File Map

| File | Change | Responsibility |
|---|---|---|
| `src/services/loginPortal.ts` | Create | Pure rule: which roles may use which login portal |
| `src/services/loginPortal.test.ts` | Create | Unit tests for the rule |
| `src/services/auth.service.ts` | Modify | Shared credential check, `adminLogin`, guard calls |
| `src/controllers/auth.controller.ts` | Modify | `adminLogin` handler |
| `src/routes/admin.routes.ts` | Modify | `POST /admin/auth/login` |
| `src/routes/adminAuth.routes.test.ts` | Create | Route exists + validates |
| `prisma/schema.prisma` | Modify | Remove `model Admin` |
| `prisma/migrations/20261007120000_drop_admin_table/migration.sql` | Create | Drop table, revoke admin sessions |
| `prisma/seed.ts` | Modify | Seed admin into `User` |
| `../CordovaRiskQ- Admin/cordova-riskq-admin/src/hooks/useAuth.tsx` | Modify | Call new endpoint |

---

### Task 1: Login portal guard

**Files:**
- Create: `src/services/loginPortal.ts`
- Test: `src/services/loginPortal.test.ts`

**Interfaces:**
- Produces: `export type LoginPortal = "app" | "admin";` and `export function assertPortalAllowed(role: string, portal: LoginPortal): void` — throws `AppError` (403 for an admin on "app", 401 for a non-admin on "admin"), returns otherwise. Also `export const ADMIN_APP_LOGIN_MESSAGE: string`.

- [ ] **Step 1: Write the failing test**

Create `src/services/loginPortal.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { ADMIN_APP_LOGIN_MESSAGE, assertPortalAllowed } from "@/services/loginPortal";
import { AppError } from "@/utils/AppError";

function errorOf(fn: () => void): AppError {
    try {
        fn();
    } catch (err) {
        assert.ok(err instanceof AppError);
        return err;
    }
    assert.fail("expected an AppError");
}

test("citizens and responders may use the mobile app login", () => {
    assert.doesNotThrow(() => assertPortalAllowed("citizen", "app"));
    assert.doesNotThrow(() => assertPortalAllowed("responder", "app"));
});

test("an admin is refused at the mobile app login with a 403 pointing to the dashboard", () => {
    const err = errorOf(() => assertPortalAllowed("admin", "app"));
    assert.equal(err.statusCode, 403);
    assert.equal(err.message, ADMIN_APP_LOGIN_MESSAGE);
    assert.equal(ADMIN_APP_LOGIN_MESSAGE, "Admin accounts can only sign in through the admin dashboard.");
});

test("only an admin may use the admin login", () => {
    assert.doesNotThrow(() => assertPortalAllowed("admin", "admin"));
});

test("a non-admin at the admin login gets the generic credentials error", () => {
    for (const role of ["citizen", "responder", ""]) {
        const err = errorOf(() => assertPortalAllowed(role, "admin"));
        assert.equal(err.statusCode, 401);
        assert.equal(err.message, "Invalid email or password");
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/loginPortal.test.ts`
Expected: FAIL — cannot find module `@/services/loginPortal`.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/loginPortal.ts`:

```ts
// Which login a role may use. The mobile app and the admin dashboard have
// separate login endpoints; this is the one rule both share. Admins sign in
// only through the dashboard, and the dashboard admits only admins.
import { AppError } from "@/utils/AppError";

export type LoginPortal = "app" | "admin";

export const ADMIN_APP_LOGIN_MESSAGE = "Admin accounts can only sign in through the admin dashboard.";

export function assertPortalAllowed(role: string, portal: LoginPortal): void {
    const isAdmin = role === "admin";

    if (portal === "app" && isAdmin) {
        throw new AppError(ADMIN_APP_LOGIN_MESSAGE, 403);
    }

    // Same message as a wrong password, so the admin login doesn't reveal
    // which emails have (non-admin) accounts.
    if (portal === "admin" && !isAdmin) {
        throw new AppError("Invalid email or password", 401);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/loginPortal.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/loginPortal.ts src/services/loginPortal.test.ts
git commit -m "feat(auth): add login portal guard separating admin and app logins"
```

---

### Task 2: Admin login endpoint + mobile logins refuse admins

**Files:**
- Modify: `src/services/auth.service.ts` (`login` at lines 17-45, `loginWithGoogle` at lines 47-117)
- Modify: `src/controllers/auth.controller.ts` (after `login`, line ~44)
- Modify: `src/routes/admin.routes.ts`
- Test: `src/routes/adminAuth.routes.test.ts`

**Interfaces:**
- Consumes: `assertPortalAllowed(role: string, portal: LoginPortal): void` from `@/services/loginPortal` (Task 1).
- Produces: `authService.adminLogin(email: string, password: string): Promise<{ user: { id, email, name, role, isOnDuty }, token: string }>`; `authController.adminLogin` handler; route `POST /api/admin/auth/login`.

- [ ] **Step 1: Write the failing route test**

Create `src/routes/adminAuth.routes.test.ts` (same pattern as `src/routes/passwordReset.routes.test.ts`: only invalid-email requests, so validation rejects them before any database work):

```ts
// Route-level checks against the real Express app. Only invalid-email
// requests are sent, so validation rejects every one before any database
// work -- the rate limiter runs first and still counts them.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import app from "@/app";

let server: http.Server;
let baseUrl = "";

before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(path: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

test("POST /api/admin/auth/login exists, is public, and validates input", async () => {
    const res = await post("/api/admin/auth/login", { email: "not-an-email", password: "x" });
    assert.equal(res.status, 400);
});

test("admin login is rate limited per IP (5 attempts per minute)", async () => {
    // One attempt was already used by the previous test.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
        statuses.push((await post("/api/admin/auth/login", { email: "not-an-email", password: "x" })).status);
    }
    assert.deepEqual(statuses.slice(0, 4), [400, 400, 400, 400]);
    assert.equal(statuses[4], 429, "the 6th attempt in the window is rejected");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/routes/adminAuth.routes.test.ts`
Expected: FAIL — first test gets 404 (route not found), not 400.

- [ ] **Step 3: Refactor `auth.service.ts` — shared credential check, `adminLogin`, mobile refusal**

Add the import at the top of `src/services/auth.service.ts`:

```ts
import { assertPortalAllowed } from "@/services/loginPortal";
```

Add these two helpers above `export const authService`:

```ts
// The email/password check both logins share. Which portal the account may
// use is decided afterwards, by the caller, so a refusal only ever reaches
// someone who already knows the password.
async function verifyPasswordCredentials(email: string, password: string) {
    const normalizedEmail = normalizeEmail(email);

    const user = await prisma.user.findFirst({
        where: {
            email: {
                equals: normalizedEmail,
                mode: "insensitive",
            },
        },
    });
    if (!user) throw new AppError("Invalid email or password", 401);

    if (!user.password) {
        // Account was created via Google and has no password set.
        throw new AppError(
            "This account uses Google Sign-In. Please log in with Google.",
            401
        );
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new AppError("Invalid email or password", 401);

    return user;
}

function sessionUser(user: { id: string; email: string; name: string | null; role: string; isOnDuty: boolean }) {
    return { id: user.id, email: user.email, name: user.name, role: user.role, isOnDuty: user.isOnDuty };
}
```

Replace the whole `login` method with:

```ts
    // The mobile app's login. Admin accounts are refused here -- they sign
    // in only through the dashboard's adminLogin below.
    async login(email: string, password: string) {
        const user = await verifyPasswordCredentials(email, password);
        assertPortalAllowed(user.role, "app");

        const token = issueSessionToken(user);
        return { user: sessionUser(user), token };
    },

    // The admin dashboard's login. Anyone but an admin gets the same 401 as
    // a wrong password.
    async adminLogin(email: string, password: string) {
        const user = await verifyPasswordCredentials(email, password);
        assertPortalAllowed(user.role, "admin");

        const token = issueSessionToken(user);
        return { user: sessionUser(user), token };
    },
```

- [ ] **Step 4: Refuse admins in `loginWithGoogle` before any linking**

In `loginWithGoogle`, replace:

```ts
        let user = await prisma.user.findUnique({ where: { googleId } });
        let isNewUser = false;
```

with:

```ts
        // Google sign-in is mobile-app only, so an admin is refused -- before
        // the link below, so an admin account never gains a Google login.
        let user = await prisma.user.findUnique({ where: { googleId } });
        if (user) assertPortalAllowed(user.role, "app");
        let isNewUser = false;
```

and replace:

```ts
            if (user) {
                // Link this Google account to their existing email/password account.
                user = await prisma.user.update({
```

with:

```ts
            if (user) {
                assertPortalAllowed(user.role, "app");
                // Link this Google account to their existing email/password account.
                user = await prisma.user.update({
```

Then replace the final return block's user object:

```ts
        return {
            user: { id: user.id, email: user.email, name: user.name, role: user.role, isOnDuty: user.isOnDuty },
            token,
            isNewUser,
        };
```

with:

```ts
        return { user: sessionUser(user), token, isNewUser };
```

(A brand-new Google account is created with the default role `"citizen"`, so it needs no check.)

- [ ] **Step 5: Add the controller handler**

In `src/controllers/auth.controller.ts`, after the `login` handler add:

```ts
    adminLogin: asyncHandler(async (req: Request, res: Response) => {
        const { email, password } = req.body;
        const result = await authService.adminLogin(email, password);
        res.status(200).json({ success: true, ...result });
    }),
```

- [ ] **Step 6: Add the route**

In `src/routes/admin.routes.ts`, add imports:

```ts
import { authController } from "@/controllers/auth.controller";
import { loginLimiter } from "@/middlewares/rateLimit.middleware";
import { loginSchema } from "@/validations/auth.validation";
```

and directly after `const router = Router();` add:

```ts
// The dashboard's own login -- public, unlike every route below. The mobile
// app's /auth/login refuses admin accounts, so this is the only way in.
router.post("/admin/auth/login", loginLimiter, validate(loginSchema), authController.adminLogin);
```

- [ ] **Step 7: Run tests and type-check**

Run: `npx tsx --test src/routes/adminAuth.routes.test.ts src/services/loginPortal.test.ts`
Expected: PASS (all 6 tests).

Run: `npm test`
Expected: PASS, no regressions.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/services/auth.service.ts src/controllers/auth.controller.ts src/routes/admin.routes.ts src/routes/adminAuth.routes.test.ts
git commit -m "feat(auth): admin-only dashboard login; mobile logins refuse admins"
```

---

### Task 3: Drop the Admin table, revoke admin sessions, reseed admin into User

**Files:**
- Modify: `prisma/schema.prisma:110-118` (remove `model Admin`)
- Create: `prisma/migrations/20261007120000_drop_admin_table/migration.sql`
- Modify: `prisma/seed.ts:36-53` (`seedAdmin`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no `prisma.admin` client; seeded admin is a `User` row with `role: "admin"`.

> ⚠️ Before Step 4, confirm with the user which database `DATABASE_URL` points at. The migration drops a table and logs out every admin. Do not run it against production without their go-ahead.

- [ ] **Step 1: Remove the model**

In `prisma/schema.prisma`, delete this block entirely (and the blank line after it):

```prisma
model Admin {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  name      String
  role      String   @default("admin") // "admin" | "super_admin"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Write the migration**

Create `prisma/migrations/20261007120000_drop_admin_table/migration.sql`:

```sql
-- The Admin table was never read: admins are User rows with role 'admin'.
DROP TABLE "Admin";

-- Admins may no longer use the mobile app login. Bumping tokenVersion
-- revokes every existing admin session, including any open in the mobile
-- app; admins sign in again through the dashboard's /admin/auth/login.
UPDATE "User" SET "tokenVersion" = "tokenVersion" + 1 WHERE "role" = 'admin';
```

- [ ] **Step 3: Point the seed at User**

In `prisma/seed.ts`, replace:

```ts
  const admin = await prisma.admin.upsert({
    where: { email },
    update: {},
    create: { email, password: hashedPassword, name, role: "super_admin" },
  });
```

with:

```ts
  // Admins are User rows with role "admin" -- the role every admin check
  // reads. They sign in through the dashboard's /admin/auth/login.
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, password: hashedPassword, name, role: "admin" },
  });
```

- [ ] **Step 4: Verify the migration matches the schema, apply, regenerate**

Run: `npx prisma migrate dev`
Expected: applies `20261007120000_drop_admin_table`, reports the database is in sync, regenerates the client. It must NOT propose creating another migration (if it does, the SQL in Step 2 doesn't match the schema — stop and fix).

Run: `npx tsc --noEmit`
Expected: no errors (nothing references `prisma.admin` any more).

Run: `git grep -n "prisma.admin\b" -- src prisma`
Expected: no output.

- [ ] **Step 5: Seed and confirm**

Run: `npm run db:seed`
Expected output includes: `Seeded admin: <ADMIN_SEED_EMAIL> (admin)`.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261007120000_drop_admin_table prisma/seed.ts
git commit -m "feat(db): drop unused Admin table; seed admin as a User with role admin"
```

---

### Task 4: Admin dashboard uses the new endpoint

**Files:**
- Modify: `C:\Users\Administrator\CORDOVARISKQ\CordovaRiskQ- Admin\cordova-riskq-admin\src\hooks\useAuth.tsx:110`

**Interfaces:**
- Consumes: `POST /api/admin/auth/login` (Task 2), same request/response shape as `/auth/login`.
- Produces: nothing.

- [ ] **Step 1: Change the endpoint**

In `useAuth.tsx`, inside `login`, replace:

```ts
    const response = await apiFetch<LoginResponse>("/auth/login", {
```

with:

```ts
    const response = await apiFetch<LoginResponse>("/admin/auth/login", {
```

Leave the `response.user.role !== "admin"` check below it in place (defense-in-depth).

- [ ] **Step 2: Type-check the dashboard**

Run (in `cordova-riskq-admin`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit in the dashboard repo**

Run `git -C "<dashboard path>" status` first to find which directory is the repository root, then:

```bash
git add src/hooks/useAuth.tsx
git commit -m "feat(auth): sign in through the admin-only /admin/auth/login"
```

---

### Task 5: End-to-end manual verification

- [ ] **Step 1:** Start the backend: `npm run dev`.
- [ ] **Step 2:** Admin on the dashboard endpoint succeeds:
  `curl -s -X POST http://localhost:8000/api/admin/auth/login -H "Content-Type: application/json" -d '{"email":"<admin email>","password":"<admin password>"}'`
  Expected: `{"success":true,"user":{...,"role":"admin"...},"token":"..."}`.
- [ ] **Step 3:** Same credentials on the mobile endpoint are refused:
  `curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d '{"email":"<admin email>","password":"<admin password>"}'`
  Expected: HTTP 403, message `Admin accounts can only sign in through the admin dashboard.`
- [ ] **Step 4:** Wrong admin password on the mobile endpoint: expected 401 `Invalid email or password` (no role leak).
- [ ] **Step 5:** A citizen's credentials on `/api/admin/auth/login`: expected 401 `Invalid email or password`. The same citizen on `/api/auth/login`: expected 200.
- [ ] **Step 6:** Start the dashboard, sign in as the admin, open a page that calls `/admin/*` (e.g. users list) — works. Then try the admin credentials in the mobile app — refused with the dashboard message.

(Wait between curl batches if you hit 429 — `loginLimiter` allows 5 attempts per minute per IP.)
