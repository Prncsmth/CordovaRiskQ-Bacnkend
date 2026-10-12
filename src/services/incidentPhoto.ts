// Pure rules for incident photos, kept free of the Cloudinary SDK so they're
// unit-tested directly (see lib/cloudinary.ts for the upload itself).

export const MAX_INCIDENT_PHOTO_BYTES = 5 * 1024 * 1024;

export const ALLOWED_INCIDENT_PHOTO_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
];

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];

// A phone can send a photo with no specific type ("application/octet-stream"
// or none) -- then its file extension decides. Cloudinary still rejects
// anything that isn't really an image (uploads are resource_type "image").
export function isAllowedIncidentPhotoType(mimeType: string, fileName = ""): boolean {
    const type = mimeType.toLowerCase();
    if (ALLOWED_INCIDENT_PHOTO_TYPES.includes(type)) return true;
    if (type !== "" && type !== "application/octet-stream") return false;
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    return fileName.includes(".") && IMAGE_EXTENSIONS.includes(extension);
}

// A report may only carry a photo from this app's own Cloudinary folder --
// never an arbitrary link a client made up (which responders would then
// open). e.g. https://res.cloudinary.com/<cloud>/image/upload/v123/<folder>/abc.jpg
export function isOwnCloudinaryUrl(url: string, cloudName: string, folder: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com") return false;
    if (parsed.search || parsed.hash || parsed.username || parsed.password) return false;
    const prefix = `/${cloudName}/image/upload/`;
    if (!parsed.pathname.startsWith(prefix)) return false;
    // Optional version segment ("v1712345678/"), then the folder.
    const rest = parsed.pathname.slice(prefix.length).replace(/^v\d+\//, "");
    return rest.startsWith(`${folder}/`) && !rest.includes("..");
}

// The Cloudinary public id inside one of our delivery URLs -- what
// uploader.destroy needs -- e.g. ".../image/upload/v123/cordova-riskq/avatars/abc.jpg"
// -> "cordova-riskq/avatars/abc". Null for anything that isn't one.
export function cloudinaryPublicId(url: string, cloudName: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const prefix = `/${cloudName}/image/upload/`;
    if (parsed.hostname !== "res.cloudinary.com" || !parsed.pathname.startsWith(prefix)) return null;
    const rest = parsed.pathname.slice(prefix.length).replace(/^v\d+\//, "");
    const withoutExtension = rest.replace(/\.[a-z0-9]+$/i, "");
    return withoutExtension.length > 0 && !withoutExtension.includes("..") ? withoutExtension : null;
}

// What to tell the app when Cloudinary refuses an upload, by its HTTP code:
// 400 = the file isn't an image it can read (the user's problem, they can
// pick another); 401/403 = our credentials are wrong or revoked (an outage
// the user can't fix -- answered like a missing config). Anything else is
// unexpected and stays a 500.
export type UploadFailure = { status: 400 | 503; message: string } | null;

export function classifyCloudinaryError(error: unknown): UploadFailure {
    const code = (error as { http_code?: unknown } | null)?.http_code;
    if (code === 400) return { status: 400, message: "That file isn't a photo we can use" };
    if (code === 401 || code === 403) {
        return { status: 503, message: "Photo upload is not available right now" };
    }
    return null;
}
