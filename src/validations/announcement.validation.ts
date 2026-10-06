import { z } from "zod";

const announcementFields = z
    .object({
        title: z
            .string()
            .min(1, "Title is required")
            .max(150, "Title must be 150 characters or fewer"),
        content: z
            .string()
            .min(1, "Content is required")
            .max(5000, "Content must be 5000 characters or fewer"),
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

export const createAnnouncementSchema = announcementFields;
// Same shape as create -- an edit replaces the announcement's fields
// wholesale (matches the admin form, which reuses its own title/content/
// priority/audience/barangay state for both publishing and editing), not a
// partial patch.
export const updateAnnouncementSchema = announcementFields;
