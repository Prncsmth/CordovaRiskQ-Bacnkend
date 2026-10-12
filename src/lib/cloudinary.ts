// Photo storage on Cloudinary: incident photos and profile photos.
// Credentials come from the environment only -- either CLOUDINARY_URL
// (cloudinary://key:secret@cloud, read by the SDK itself) or the three
// CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
// variables. With none set, uploads answer 503 and the app carries on
// without the photo.
import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from "cloudinary";

import { cloudinaryPublicId, isOwnCloudinaryUrl } from "@/services/incidentPhoto";

const INCIDENT_PHOTO_FOLDER = "cordova-riskq/incidents";
const AVATAR_FOLDER = "cordova-riskq/avatars";
// The app already shrinks photos before upload; this caps anything that
// slips through (e.g. an older app build) so stored files stay small.
const MAX_STORED_EDGE_PX = 1600;
// Profile photos: a square crop centered on the face, small enough to load
// instantly in a list.
const AVATAR_EDGE_PX = 400;

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    cloudinary.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
        secure: true,
    });
}

function cloudName(): string | undefined {
    return cloudinary.config().cloud_name;
}

export function isCloudinaryConfigured(): boolean {
    const config = cloudinary.config();
    return Boolean(config.cloud_name && config.api_key && config.api_secret);
}

function uploadImage(file: Buffer, options: UploadApiOptions): Promise<string> {
    return new Promise((resolve, reject) => {
        cloudinary.uploader
            .upload_stream({ resource_type: "image", ...options }, (error, result?: UploadApiResponse) => {
                if (error || !result) return reject(error ?? new Error("Empty Cloudinary response"));
                resolve(result.secure_url);
            })
            .end(file);
    });
}

export function uploadIncidentPhoto(file: Buffer): Promise<string> {
    return uploadImage(file, {
        folder: INCIDENT_PHOTO_FOLDER,
        transformation: [{ width: MAX_STORED_EDGE_PX, height: MAX_STORED_EDGE_PX, crop: "limit" }],
    });
}

export function uploadAvatar(file: Buffer): Promise<string> {
    return uploadImage(file, {
        folder: AVATAR_FOLDER,
        transformation: [
            { width: AVATAR_EDGE_PX, height: AVATAR_EDGE_PX, crop: "fill", gravity: "face" },
        ],
    });
}

// Best-effort removal of a replaced/removed profile photo -- a failure only
// leaves an unused file behind, so it never fails the request.
export async function deleteAvatar(url: string): Promise<void> {
    const name = cloudName();
    if (!name || !isOwnCloudinaryUrl(url, name, AVATAR_FOLDER)) return;
    const publicId = cloudinaryPublicId(url, name);
    if (!publicId) return;
    try {
        await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    } catch {
        // ignore
    }
}

// Only photos this backend uploaded may be attached to a report.
export function isIncidentPhotoUrl(url: string): boolean {
    const name = cloudName();
    return !!name && isOwnCloudinaryUrl(url, name, INCIDENT_PHOTO_FOLDER);
}
