import { z } from "zod";

export const KNOWN_FACILITIES = ["Water", "Power", "Medical Aid", "Restrooms"] as const;

export const updateEvacuationCenterSchema = z.object({
    status: z.enum(["open", "full"]).optional(),
    facilities: z.array(z.enum(KNOWN_FACILITIES)).optional(),
});
