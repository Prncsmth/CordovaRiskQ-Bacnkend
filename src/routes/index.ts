import { Router } from "express";
import testRoutes from "@/routes/test.routes";
import authRoutes from "@/routes/auth.routes";
import userRoutes from "@/routes/user.routes";
import sosRoutes from "@/routes/sos.routes";
import incidentRoutes from "@/routes/incident.routes";
import adminRoutes from "@/routes/admin.routes";
import adminAuthRoutes from "@/routes/admin-auth.routes";
import tideRoutes from "@/routes/tide.routes";
import announcementRoutes from "@/routes/announcement.routes";
import notificationRoutes from "@/routes/notification.routes";
import historyRoutes from "@/routes/history.routes";
import evacuationCenterRoutes from "@/routes/evacuationCenter.routes";
import responderRoutes from "@/routes/responder.routes";
import hotlineRoutes from "@/routes/hotline.routes";

// Central router — mount all feature route files here.
// As you add new resources, do: router.use(entityRoutes) below.
const router = Router();

router.use(testRoutes);
router.use(authRoutes);
router.use(userRoutes);
router.use(sosRoutes);
router.use(incidentRoutes);
router.use(adminRoutes);
router.use(adminAuthRoutes);
router.use(tideRoutes);
router.use(announcementRoutes);
router.use(notificationRoutes);
router.use(historyRoutes);
router.use(evacuationCenterRoutes);
router.use(responderRoutes);
router.use(hotlineRoutes);

export default router;

