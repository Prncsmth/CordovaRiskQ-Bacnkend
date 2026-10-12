import { Router } from "express";
import { userController } from "@/controllers/user.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { parseIncidentPhoto } from "@/middlewares/incidentPhotoUpload.middleware";
import { avatarLimiter, changePasswordLimiter } from "@/middlewares/rateLimit.middleware";
import { requireResponder } from "@/middlewares/requireResponder.middleware";
import { validate } from "@/middlewares/validate.middleware";
import {
    updateProfileSchema,
    changePasswordSchema,
    updatePushTokenSchema,
    updateDutyStatusSchema,
} from "@/validations/user.validation";

const router = Router();

router.get("/users/me", authenticate, userController.getMe);
router.put(
    "/users/me",
    authenticate,
    validate(updateProfileSchema),
    userController.updateProfile
);
// Optional profile photo, multipart field "photo" (same image rules as an
// incident photo).
router.post(
    "/users/me/avatar",
    authenticate,
    avatarLimiter,
    parseIncidentPhoto,
    userController.uploadAvatar
);
router.delete("/users/me/avatar", authenticate, avatarLimiter, userController.removeAvatar);
router.post(
    "/users/change-password",
    authenticate,
    changePasswordLimiter,
    validate(changePasswordSchema),
    userController.changePassword
);
router.patch(
    "/users/push-token",
    authenticate,
    validate(updatePushTokenSchema),
    userController.updatePushToken
);
router.patch(
    "/users/duty-status",
    authenticate,
    requireResponder,
    validate(updateDutyStatusSchema),
    userController.updateDutyStatus
);

export default router;
