import { Router } from "express";
import { authController } from "@/controllers/auth.controller";
import { validate } from "@/middlewares/validate.middleware";
import {
    loginLimiter,
    registerLimiter,
    requestOtpLimiter,
    verifyOtpLimiter,
} from "@/middlewares/rateLimit.middleware";
import {
    registerSchema,
    loginSchema,
    googleAuthSchema,
    requestRegistrationOtpSchema,
    verifyRegistrationOtpSchema,
} from "@/validations/auth.validation";

const router = Router();

router.post(
    "/auth/register",
    registerLimiter,
    validate(registerSchema),
    authController.register
);
router.post(
    "/auth/register/request-otp",
    requestOtpLimiter,
    validate(requestRegistrationOtpSchema),
    authController.requestRegistrationOtp
);
router.post(
    "/auth/register/verify-otp",
    verifyOtpLimiter,
    validate(verifyRegistrationOtpSchema),
    authController.verifyRegistrationOtp
);
router.post("/auth/login", loginLimiter, validate(loginSchema), authController.login);
router.post(
    "/auth/google",
    loginLimiter,
    validate(googleAuthSchema),
    authController.google
);

export default router;
