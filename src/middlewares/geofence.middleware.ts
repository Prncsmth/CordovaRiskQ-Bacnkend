import { NextFunction, Request, Response } from "express";
import { AppError } from "@/utils/AppError";
import { isInsideCordova } from "@/utils/geofence";

const INCIDENT_MESSAGE = "Incident reports are only allowed within the Municipality of Cordova, Cebu.";
const SOS_MESSAGE = "SOS is only available within the Municipality of Cordova, Cebu.";

// Runs after validate(schema) in the route chain, so req.body's fields are
// already guaranteed present and numeric -- this only does the polygon math.
export function requireIncidentInsideCordova(req: Request, res: Response, next: NextFunction) {
    const { latitude, longitude, reporterLatitude, reporterLongitude } = req.body;
    const pinOk = isInsideCordova(latitude, longitude);
    const reporterOk = isInsideCordova(reporterLatitude, reporterLongitude);
    if (!pinOk || !reporterOk) {
        return next(new AppError(INCIDENT_MESSAGE, 403));
    }
    next();
}

export function requireSosInsideCordova(req: Request, res: Response, next: NextFunction) {
    const { latitude, longitude } = req.body;
    if (!isInsideCordova(latitude, longitude)) {
        return next(new AppError(SOS_MESSAGE, 403));
    }
    next();
}
