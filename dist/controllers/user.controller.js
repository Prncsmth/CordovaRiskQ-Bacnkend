import { userService } from "@/services/user.service";
import { asyncHandler } from "@/utils/asyncHandler";
export const userController = {
    getMe: asyncHandler(async (req, res) => {
        const user = await userService.getById(req.userId);
        res.status(200).json({ success: true, user });
    }),
    updateProfile: asyncHandler(async (req, res) => {
        const user = await userService.updateProfile(req.userId, req.body);
        res.status(200).json({ success: true, user });
    }),
    changePassword: asyncHandler(async (req, res) => {
        await userService.changePassword(req.userId, req.body);
        res.status(200).json({ success: true });
    }),
};
//# sourceMappingURL=user.controller.js.map