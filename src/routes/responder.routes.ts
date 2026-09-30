import { Router } from "express";
import { responderController } from "@/controllers/responder.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";
import { requireResponder } from "@/middlewares/requireResponder.middleware";
import { validate } from "@/middlewares/validate.middleware";
import { updateResponderLocationSchema } from "@/validations/tracking.validation";

const router = Router();

// Was previously missing requireResponder -- only failed safe incidentally
// (trackingService.updateResponderLocation separately 403s unless the
// caller has an active "on the way" roster row, which a citizen can never
// obtain). Adding the same guard every other responder-only route already
// has makes that explicit instead of relying on a second system's side effect.
router.patch(
    "/responders/location",
    authenticate,
    requireResponder,
    validate(updateResponderLocationSchema),
    responderController.updateLocation
);

export default router;
