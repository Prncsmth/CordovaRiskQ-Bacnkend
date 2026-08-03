import { Router } from "express";
import { authController } from "@/controllers/auth.controller";
import { validate } from "@/middlewares/validate.middleware";
import {
    registerSchema,
    loginSchema,
    googleAuthSchema,
} from "@/validations/auth.validation";

const router = Router();

router.post("/auth/register", validate(registerSchema), authController.register);
router.post("/auth/login", validate(loginSchema), authController.login);
router.post("/auth/google", validate(googleAuthSchema), authController.google);

export default router;
