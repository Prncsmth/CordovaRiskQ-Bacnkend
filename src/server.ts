import app from "./app";
import { startTidePolling } from "@/lib/tidePolling";

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startTidePolling();
});
