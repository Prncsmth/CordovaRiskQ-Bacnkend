import http from "http";

import app from "./app";
import { startIncidentEscalationPolling } from "@/lib/incidentEscalationPolling";
import { startSosExpiryPolling } from "@/lib/sosExpiryPolling";
import { startTidePolling } from "@/lib/tidePolling";
import { initRealtime } from "@/realtime/socket";
import { onAdminActivity } from "@/realtime/emit";
import { notificationService } from "@/services/notification.service";
import { adminActivityNotification } from "@/services/notificationWindow";

const PORT = process.env.PORT || 8000;

const httpServer = http.createServer(app);
initRealtime(httpServer);

// Every admin activity also lands in each admin's own notification inbox
// (per-admin read state on the server, 24h window) -- dashboard only, so
// no Expo push. Best-effort: createForAllAdmins catches its own errors.
onAdminActivity((activity) => {
    void notificationService.createForAllAdmins(adminActivityNotification(activity), { push: false });
});

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startTidePolling();
    startSosExpiryPolling();
    startIncidentEscalationPolling();
});
