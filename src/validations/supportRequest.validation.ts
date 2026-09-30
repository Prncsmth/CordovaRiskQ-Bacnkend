import { z } from "zod";

export const SUPPORT_TOPICS = ["App issue", "Report help", "Account", "Other"] as const;
export const SUPPORT_STATUSES = ["open", "in_progress", "resolved"] as const;

export const createSupportRequestSchema = z.object({
    topic: z.enum(SUPPORT_TOPICS),
    subject: z.string().trim().max(80).optional(),
    message: z.string().trim().min(1, "Message is required").max(600),
});

export const updateSupportRequestStatusSchema = z.object({
    status: z.enum(SUPPORT_STATUSES),
});
