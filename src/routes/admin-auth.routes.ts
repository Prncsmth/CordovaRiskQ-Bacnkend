import { Router } from "express";
import { adminAuthController } from "@/controllers/admin-auth.controller";
import { validate } from "@/middlewares/validate.middleware";
import { adminLoginSchema } from "@/validations/admin-auth.validation";

const router = Router();

router.post("/admin/auth/login", validate(adminLoginSchema), adminAuthController.login);

export default router;
