import { authService } from "@/services/auth.service";
import { asyncHandler } from "@/utils/asyncHandler";
export const authController = {
    register: asyncHandler(async (req, res) => {
        const { email, password, name } = req.body;
        const result = await authService.register(email, password, name);
        res.status(201).json({ success: true, ...result });
    }),
    login: asyncHandler(async (req, res) => {
        const { email, password } = req.body;
        const result = await authService.login(email, password);
        res.status(200).json({ success: true, ...result });
    }),
    google: asyncHandler(async (req, res) => {
        const { idToken } = req.body;
        const result = await authService.loginWithGoogle(idToken);
        res.status(200).json({ success: true, ...result });
    }),
};
//# sourceMappingURL=auth.controller.js.map