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

export function isAllowedIncidentPhotoType(mimeType: string): boolean {
    return ALLOWED_INCIDENT_PHOTO_TYPES.includes(mimeType.toLowerCase());
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
