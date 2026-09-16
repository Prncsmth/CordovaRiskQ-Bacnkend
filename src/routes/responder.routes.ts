import { Router } from "express";
import { responderController } from "@/controllers/responder.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { updateResponderLocationSchema } from "@/validations/tracking.validation";

const router = Router();

router.patch(
    "/responders/location",
    authenticate,
    validate(updateResponderLocationSchema),
    responderController.updateLocation
);

export default router;
