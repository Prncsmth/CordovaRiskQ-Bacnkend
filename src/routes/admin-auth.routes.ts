import { Router } from "express";
import { adminAuthController } from "@/controllers/admin-auth.controller";
import { authenticateAdmin } from "@/middlewares/authenticateAdmin.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { adminLoginSchema } from "@/validations/admin-auth.validation";

const router = Router();

router.post("/admin/auth/login", validate(adminLoginSchema), adminAuthController.login);
router.get("/admin/auth/me", authenticateAdmin, adminAuthController.me);

export default router;
