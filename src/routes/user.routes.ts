import { Router } from "express";
import { userController } from "@/controllers/user.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { validate } from "@/middlewares/validate.middleware";
import {
    updateProfileSchema,
    changePasswordSchema,
} from "@/validations/user.validation";

const router = Router();

router.get("/users/me", authenticate, userController.getMe);
router.put(
    "/users/me",
    authenticate,
    validate(updateProfileSchema),
    userController.updateProfile
);
router.post(
    "/users/change-password",
    authenticate,
    validate(changePasswordSchema),
    userController.changePassword
);

export default router;
