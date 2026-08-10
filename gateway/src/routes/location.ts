import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { IDENTITIES_DIR, requireGatewayUser } from '../fabric';
import { asyncHandler, HttpError } from './util';

export const locationRouter = Router();

// Istanbul -- an unset user still gets a sane, non-empty result set.
const DEFAULT_LAT = Number(process.env.DEFAULT_LAT) || 41.0082;
const DEFAULT_LNG = Number(process.env.DEFAULT_LNG) || 28.9784;

interface StoredLocation {
  lat: number;
  lng: number;
}

function locationFilePath(): string {
  return path.join(IDENTITIES_DIR, requireGatewayUser(), 'location.json');
}

function validateCoords(lat: unknown, lng: unknown): StoredLocation {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || latN < -90 || latN > 90) {
    throw new HttpError(400, 'lat must be a number in [-90, 90]');
  }
  if (!Number.isFinite(lngN) || lngN < -180 || lngN > 180) {
    throw new HttpError(400, 'lng must be a number in [-180, 180]');
  }
  return { lat: latN, lng: lngN };
}

// CAR_LOCATION_ADDENDUM.md section 2.1: the car's location is never written
// to the ledger and never sent to a Fabric peer. These routes only read/write
// a file on this single-tenant gateway's own identity volume -- they never
// call withContract() and never touch the chaincode.
locationRouter.get(
  '/me/location',
  asyncHandler(async (_req, res) => {
    const file = locationFilePath();
    if (fs.existsSync(file)) {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredLocation;
      res.json({ lat: stored.lat, lng: stored.lng, source: 'file' });
      return;
    }

    if (process.env.USER_LAT !== undefined && process.env.USER_LNG !== undefined) {
      const { lat, lng } = validateCoords(process.env.USER_LAT, process.env.USER_LNG);
      res.json({ lat, lng, source: 'env' });
      return;
    }

    res.json({ lat: DEFAULT_LAT, lng: DEFAULT_LNG, source: 'default' });
  })
);

// Dev/demo affordance, same pattern as the faucet (routes/token.ts): no
// runtime gate, just documented as dev-only. Writes location.json for this
// gateway's own identity; never involves the peer.
locationRouter.post(
  '/me/location',
  asyncHandler(async (req, res) => {
    const body = req.body as { lat?: unknown; lng?: unknown };
    const { lat, lng } = validateCoords(body.lat, body.lng);
    fs.writeFileSync(locationFilePath(), JSON.stringify({ lat, lng }));
    res.json({ lat, lng });
  })
);
