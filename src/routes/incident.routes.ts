import { Router } from "express";
import { incidentController } from "@/controllers/incident.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireIncidentInsideCordova } from "@/middlewares/geofence.middleware";
import { validate } from "@/middlewares/validate.middleware";
import {
    createIncidentSchema,
    updateIncidentStatusSchema,
    updateMyResponderStatusSchema,
} from "@/validations/incident.validation";

const router = Router();

router.post(
    "/incidents",
    authenticate,
    validate(createIncidentSchema),
    requireIncidentInsideCordova,
    incidentController.create
);
router.get("/incidents", authenticate, incidentController.list);
router.get("/incidents/mine", authenticate, incidentController.listMine);
router.get("/incidents/completed", authenticate, incidentController.listCompleted);
router.get("/incidents/:id", authenticate, incidentController.getById);
router.patch(
    "/incidents/:id/responders/me",
    authenticate,
    validate(updateMyResponderStatusSchema),
    incidentController.updateMyResponderStatus,
);
router.patch(
    "/incidents/:id/status",
    authenticate,
    validate(updateIncidentStatusSchema),
    incidentController.updateStatus
);
router.post(
    "/incidents/:id/ring",
    authenticate,
    incidentController.ringTeam
);
router.patch(
    "/incidents/:id/cancel",
    authenticate,
    incidentController.cancelByReporter
);
router.delete("/incidents/:id", authenticate, incidentController.removeOwnReport);
router.get("/incidents/:id/tracking", authenticate, incidentController.getTracking);

export default router;
