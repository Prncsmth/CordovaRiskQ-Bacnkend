import http from "http";

import app from "./app";
import { startTidePolling } from "@/lib/tidePolling";
import { initRealtime } from "@/realtime/socket";

const PORT = process.env.PORT || 8000;

const httpServer = http.createServer(app);
initRealtime(httpServer);

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startTidePolling();
});
