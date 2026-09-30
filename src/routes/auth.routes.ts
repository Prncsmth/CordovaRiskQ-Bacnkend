import { Router } from "express";
import { authController } from "@/controllers/auth.controller";
import { validate } from "@/middlewares/validate.middleware";
import {
    loginLimiter,
    requestOtpLimiter,
    verifyOtpLimiter,
} from "@/middlewares/rateLimit.middleware";
import {
    loginSchema,
    googleAuthSchema,
    requestRegistrationOtpSchema,
    resendRegistrationOtpSchema,
    verifyRegistrationOtpSchema,
} from "@/validations/auth.validation";

const router = Router();

// Registration requires the emailed 6-digit code -- there is no route that
// creates an account without it.
router.post(
    "/auth/register/request-otp",
    requestOtpLimiter,
    validate(requestRegistrationOtpSchema),
    authController.requestRegistrationOtp
);
// Shares request-otp's limiter: both send an email.
router.post(
    "/auth/register/resend-otp",
    requestOtpLimiter,
    validate(resendRegistrationOtpSchema),
    authController.resendRegistrationOtp
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
