import { Router } from "express";
import { userController } from "@/controllers/user.controller";
import { authenticate } from "@/middlewares/authenticate.middleware";

const router = Router();

router.get("/users/me", authenticate, userController.getMe);

export default router;
