// src/utils/geofence.ts
// Mirrors the frontend's utils/geofence.ts -- same boundary GeoJSON, same
// function signature, no shared package between the two repos (see
// constants/location.ts's header comment for that existing convention).
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

import cordovaBoundary from "@/constants/cordovaBoundary.geojson.json";

export function isInsideCordova(latitude: number, longitude: number): boolean {
    return booleanPointInPolygon([longitude, latitude], cordovaBoundary as any);
}
