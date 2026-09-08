import { Router } from "express";
import { incidentController } from "@/controllers/incident.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
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
    incidentController.create
);
router.get("/incidents", authenticate, incidentController.list);
router.get("/incidents/mine", authenticate, incidentController.listMine);
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

export default router;
