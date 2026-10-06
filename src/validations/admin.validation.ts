import { z } from "zod";
import { CORDOVA_BARANGAY_NAMES } from "@/constants/barangays";

export const updateUserRoleSchema = z.object({
    role: z.enum(["citizen", "responder"]),
    unit: z.enum(["BDRRMO", "MDRRMO"]).nullable().optional(),
});

export const updateResponderBarangaySchema = z.object({
    barangay: z.enum(CORDOVA_BARANGAY_NAMES).nullable(),
});
