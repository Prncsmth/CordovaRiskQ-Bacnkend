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
