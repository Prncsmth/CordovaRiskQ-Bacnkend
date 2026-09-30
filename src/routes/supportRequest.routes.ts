import { Router } from "express";
import { supportRequestController } from "@/controllers/supportRequest.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireAdmin } from "@/middlewares/requireAdmin.middleware";
import { supportRequestLimiter } from "@/middlewares/rateLimit.middleware";
import { validate } from "@/middlewares/validate.middleware";
import {
    createSupportRequestSchema,
    updateSupportRequestStatusSchema,
} from "@/validations/supportRequest.validation";

const router = Router();

router.post(
    "/support-requests",
    authenticate,
    supportRequestLimiter,
    validate(createSupportRequestSchema),
    supportRequestController.create
);
router.get("/support-requests/mine", authenticate, supportRequestController.listMine);

router.get(
    "/admin/support-requests",
    authenticate,
    requireAdmin,
    supportRequestController.listForAdmin
);
router.patch(
    "/admin/support-requests/:id/status",
    authenticate,
    requireAdmin,
    validate(updateSupportRequestStatusSchema),
    supportRequestController.updateStatus
);

export default router;
