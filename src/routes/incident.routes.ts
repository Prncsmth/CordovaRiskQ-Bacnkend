import { Router } from "express";
import { incidentController } from "@/controllers/incident.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { validate } from "@/middlewares/validate.middleware";
import {
    createIncidentSchema,
    updateIncidentStatusSchema,
} from "@/validations/incident.validation";

const router = Router();

router.post(
    "/incidents",
    authenticate,
    validate(createIncidentSchema),
    incidentController.create
);
router.get("/incidents", authenticate, incidentController.list);
router.get("/incidents/:id", authenticate, incidentController.getById);
router.patch("/incidents/:id/accept", authenticate, incidentController.accept);
router.patch(
    "/incidents/:id/status",
    authenticate,
    validate(updateIncidentStatusSchema),
    incidentController.updateStatus
);

export default router;
