import { Router } from "express";
import { adminController } from "@/controllers/admin.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireAdmin } from "@/middlewares/requireAdmin.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { updateUserRoleSchema } from "@/validations/admin.validation";

const router = Router();

router.get("/admin/users", authenticate, requireAdmin, adminController.listUsers);
router.patch(
    "/admin/users/:id/role",
    authenticate,
    requireAdmin,
    validate(updateUserRoleSchema),
    adminController.updateUserRole
);

export default router;
