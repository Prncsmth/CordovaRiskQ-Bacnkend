import { Router } from "express";
import { authController } from "@/controllers/auth.controller";
import { validate } from "@/middlewares/validate.middleware";
import { loginLimiter, registerLimiter } from "@/middlewares/rateLimit.middleware";
import {
    registerSchema,
    loginSchema,
    googleAuthSchema,
} from "@/validations/auth.validation";

const router = Router();

router.post(
    "/auth/register",
    registerLimiter,
    validate(registerSchema),
    authController.register
);
router.post("/auth/login", loginLimiter, validate(loginSchema), authController.login);
router.post(
    "/auth/google",
    loginLimiter,
    validate(googleAuthSchema),
    authController.google
);

export default router;
