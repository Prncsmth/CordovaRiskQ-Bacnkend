import { Router } from "express";
import { sosController } from "@/controllers/sos.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireAdmin } from "@/middlewares/requireAdmin.middleware";
import { requireSosInsideCordova } from "@/middlewares/geofence.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { triggerSosSchema } from "@/validations/sos.validation";

const router = Router();

router.post(
    "/sos",
    authenticate,
    validate(triggerSosSchema),
    requireSosInsideCordova,
    sosController.trigger
);
router.get("/admin/sos-alerts/summary", authenticate, requireAdmin, sosController.getAdminSummary);
router.get("/admin/sos-alerts", authenticate, requireAdmin, sosController.listForAdmin);

export default router;
