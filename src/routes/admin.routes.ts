import { Router } from "express";
import { adminController } from "@/controllers/admin.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireAdmin } from "@/middlewares/requireAdmin.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { updateUserRoleSchema } from "@/validations/admin.validation";

const router = Router();

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
router.get("/admin/responders/summary", authenticate, requireAdmin, adminController.getResponderSummary);
router.get("/admin/responders/en-route", authenticate, requireAdmin, adminController.listEnRouteResponders);
router.get("/admin/activity", authenticate, requireAdmin, adminController.getRecentActivity);

export default router;
