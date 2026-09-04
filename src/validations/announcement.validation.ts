import { z } from "zod";

export const createAnnouncementSchema = z
    .object({
        title: z.string().min(1, "Title is required"),
        content: z.string().min(1, "Content is required"),
        priority: z.enum(["Normal", "Urgent"]),
        audience: z.enum(["All Users", "Responders Only", "Specific Barangay"]),
        barangayName: z.string().min(1).optional(),
    })
    .superRefine((data, ctx) => {
        if (data.audience === "Specific Barangay" && !data.barangayName) {
            ctx.addIssue({
                code: "custom",
                message: "barangayName is required when audience is Specific Barangay",
                path: ["barangayName"],
            });
        }
        if (data.audience !== "Specific Barangay" && data.barangayName) {
            ctx.addIssue({
                code: "custom",
                message: "barangayName must be omitted unless audience is Specific Barangay",
                path: ["barangayName"],
            });
        }
    });
