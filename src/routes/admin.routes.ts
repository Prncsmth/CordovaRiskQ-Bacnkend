import { Router } from "express";
import { authController } from "@/controllers/auth.controller";
import { adminController } from "@/controllers/admin.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireAdmin } from "@/middlewares/requireAdmin.middleware";
import { loginLimiter } from "@/middlewares/rateLimit.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { loginSchema } from "@/validations/auth.validation";
import { updateResponderBarangaySchema, updateUserRoleSchema } from "@/validations/admin.validation";

const router = Router();

// The dashboard's own login -- public, unlike every route below. The mobile
// app's /auth/login refuses admin accounts, so this is the only way in.
router.post("/admin/auth/login", loginLimiter, validate(loginSchema), authController.adminLogin);

router.get("/admin/users", authenticate, requireAdmin, adminController.listUsers);
router.get("/admin/users/names", authenticate, requireAdmin, adminController.listUserNames);
router.get("/admin/users/:id", authenticate, requireAdmin, adminController.getUserById);
router.patch(
    "/admin/users/:id/role",
    authenticate,
    requireAdmin,
    validate(updateUserRoleSchema),
    adminController.updateUserRole
);
router.patch(
    "/admin/users/:id/barangay",
    authenticate,
    requireAdmin,
    validate(updateResponderBarangaySchema),
    adminController.updateResponderBarangay
);
router.get("/admin/responders/summary", authenticate, requireAdmin, adminController.getResponderSummary);
router.get("/admin/responders/en-route", authenticate, requireAdmin, adminController.listEnRouteResponders);
router.get("/admin/activity", authenticate, requireAdmin, adminController.getRecentActivity);

export default router;
