import type { NextFunction, Request, Response } from "express";
import multer from "multer";

import { MAX_INCIDENT_PHOTO_BYTES, isAllowedIncidentPhotoType } from "@/services/incidentPhoto";
import { AppError } from "@/utils/AppError";

// One image in memory under the "photo" field -- it goes straight on to
// Cloudinary, never to Render's (ephemeral) disk.
const parser = multer({
    storage: multer.memoryStorage(),
    // One file and no room for anything else: a handful of tiny text
    // fields at most, so a request can't stuff the form with junk.
    limits: { fileSize: MAX_INCIDENT_PHOTO_BYTES, files: 1, fields: 5, fieldSize: 1024, parts: 6 },
    fileFilter(_req, file, callback) {
        if (isAllowedIncidentPhotoType(file.mimetype)) return callback(null, true);
        callback(new AppError("Only JPEG, PNG, WebP or HEIC photos can be attached", 400));
    },
}).single("photo");

// multer's own errors (too large, wrong field) become clean 4xx responses
// instead of falling through to the 500 handler.
export function parseIncidentPhoto(req: Request, res: Response, next: NextFunction) {
    parser(req, res, (err: unknown) => {
        if (!err) return next();
        if (err instanceof AppError) return next(err);
        if (err instanceof multer.MulterError) {
            return next(
                err.code === "LIMIT_FILE_SIZE"
                    ? new AppError("Photo must be 5 MB or smaller", 413)
                    : new AppError("Send one photo in the \"photo\" field", 400)
            );
        }
        next(err);
    });
}
