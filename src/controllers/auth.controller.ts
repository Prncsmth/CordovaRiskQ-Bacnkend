import { Request, Response } from "express";
import { authService } from "@/services/auth.service";
import { passwordResetService } from "@/services/passwordReset.service";
import { pendingRegistrationService } from "@/services/pendingRegistration.service";
import { asyncHandler } from "@/utils/asyncHandler";

export const authController = {
    requestRegistrationOtp: asyncHandler(async (req: Request, res: Response) => {
        const { name, email, password } = req.body;
        // Never includes the code -- only the email carries it.
        const result = await pendingRegistrationService.requestOtp({ name, email, password });
        res.status(200).json({ success: true, ...result });
    }),

    resendRegistrationOtp: asyncHandler(async (req: Request, res: Response) => {
        const { email } = req.body;
        const result = await pendingRegistrationService.resendOtp({ email });
        res.status(200).json({ success: true, ...result });
    }),

    verifyRegistrationOtp: asyncHandler(async (req: Request, res: Response) => {
        const { email, code } = req.body;
        const result = await pendingRegistrationService.verifyOtp({ email, code });
        res.status(200).json({ success: true, ...result });
    }),

    forgotPassword: asyncHandler(async (req: Request, res: Response) => {
        const { email } = req.body;
        // Identical response whether or not the email has an account.
        const result = await passwordResetService.requestReset({ email });
        res.status(200).json({ success: true, ...result });
    }),

    resetPassword: asyncHandler(async (req: Request, res: Response) => {
        const { email, code, newPassword } = req.body;
        const result = await passwordResetService.reset({ email, code, newPassword });
        res.status(200).json({ success: true, ...result });
    }),

    login: asyncHandler(async (req: Request, res: Response) => {
        const { email, password } = req.body;
        const result = await authService.login(email, password);
        res.status(200).json({ success: true, ...result });
    }),

    google: asyncHandler(async (req: Request, res: Response) => {
        const { idToken } = req.body;
        const result = await authService.loginWithGoogle(idToken);
        res.status(200).json({ success: true, ...result });
    }),
};
