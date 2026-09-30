import { Router } from "express";
import { incidentController } from "@/controllers/incident.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireIncidentInsideCordova } from "@/middlewares/geofence.middleware";
import { requireResponder } from "@/middlewares/requireResponder.middleware";
import { requireResponderOrAdmin } from "@/middlewares/requireResponderOrAdmin.middleware";
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
// City-wide active-incident list is responder/admin facing -- a citizen
// uses /incidents/mine for their own reports instead. Was previously
// missing any role gate at all (unlike every other route below), letting
// any authenticated citizen enumerate every other user's active
// incident/SOS report city-wide.
router.get("/incidents", authenticate, requireResponderOrAdmin, incidentController.list);
router.get("/incidents/mine", authenticate, incidentController.listMine);
router.get(
    "/incidents/completed",
    authenticate,
    requireResponder,
    incidentController.listCompleted
);
router.get("/incidents/:id", authenticate, incidentController.getById);
router.patch(
    "/incidents/:id/responders/me",
    authenticate,
    requireResponder,
    validate(updateMyResponderStatusSchema),
    incidentController.updateMyResponderStatus,
);
router.patch(
    "/incidents/:id/status",
    authenticate,
    requireResponder,
    validate(updateIncidentStatusSchema),
    incidentController.updateStatus
);
router.post(
    "/incidents/:id/ring",
    authenticate,
    requireResponder,
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
