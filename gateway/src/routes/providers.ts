import { Router } from 'express';
import { withContract } from '../fabric';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const providersRouter = Router();

const LAT_LNG_SCALE = 1_000_000;

interface ChargingProvider {
  providerId: string;
  latitude: number;
  longitude: number;
  [key: string]: unknown;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

providersRouter.post(
  '/providers',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const body = req.body as {
      providerType?: string;
      lat?: number;
      lng?: number;
      locationLabel?: string;
      pricePerkWh?: number;
      availableEnergy?: number;
      numberOfSlots?: number;
      connectorTypes?: string[];
      approvalRequired?: boolean;
      ipfsHash?: string;
    };

    if (
      !body.providerType ||
      body.lat === undefined ||
      body.lng === undefined ||
      body.pricePerkWh === undefined ||
      !body.numberOfSlots
    ) {
      throw new HttpError(
        400,
        'providerType, lat, lng, pricePerkWh, and numberOfSlots are required'
      );
    }

    const providerPayload = {
      providerType: body.providerType,
      latitude: Math.round(body.lat * LAT_LNG_SCALE),
      longitude: Math.round(body.lng * LAT_LNG_SCALE),
      locationLabel: body.locationLabel ?? '',
      pricePerkWh: body.pricePerkWh,
      availableEnergy: body.availableEnergy ?? 0,
      numberOfSlots: body.numberOfSlots,
      connectorTypes: body.connectorTypes ?? [],
      approvalRequired: body.approvalRequired ?? false,
      ipfsHash: body.ipfsHash ?? '',
    };

    const result = await withContract(identity, (contract) =>
      contract.submitTransaction('RegisterProvider', JSON.stringify(providerPayload))
    );
    res.status(201).json({ providerId: Buffer.from(result).toString('utf8') });
  })
);

providersRouter.get(
  '/providers',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { type, minPrice, maxPrice, lat, lng, radiusKm, ownerId } = req.query as Record<
      string,
      string | undefined
    >;

    const selector: Record<string, unknown> = {};
    if (type) selector.providerType = type;
    // Not in the spec's query param list, but needed by the frontend's
    // provider-owner view ("my providers"); QueryProviders already accepts
    // an arbitrary Mango selector so this is a passthrough, not a chaincode change.
    if (ownerId) selector.ownerId = ownerId;
    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceRange: Record<string, number> = {};
      if (minPrice !== undefined) priceRange.$gte = Number(minPrice);
      if (maxPrice !== undefined) priceRange.$lte = Number(maxPrice);
      selector.pricePerkWh = priceRange;
    }

    let center: { lat: number; lng: number; radiusKm: number } | undefined;
    if (lat !== undefined && lng !== undefined && radiusKm !== undefined) {
      center = { lat: Number(lat), lng: Number(lng), radiusKm: Number(radiusKm) };
      // Bounding box in degrees, then scaled to the chaincode's fixed-point
      // representation. Longitude degrees shrink with latitude, so widen
      // the box using cos(lat); clamp to avoid divide-by-huge near poles.
      const latDelta = center.radiusKm / 111;
      const lngDelta = center.radiusKm / (111 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01));
      selector.latitude = {
        $gte: Math.round((center.lat - latDelta) * LAT_LNG_SCALE),
        $lte: Math.round((center.lat + latDelta) * LAT_LNG_SCALE),
      };
      selector.longitude = {
        $gte: Math.round((center.lng - lngDelta) * LAT_LNG_SCALE),
        $lte: Math.round((center.lng + lngDelta) * LAT_LNG_SCALE),
      };
    }

    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('QueryProviders', JSON.stringify(selector))
    );
    let providers = JSON.parse(Buffer.from(result).toString('utf8')) as ChargingProvider[];

    // Radius refinement client-side (of the chaincode, i.e. here in the
    // gateway) per MVP_BUILD_SPEC.md section 9: the bounding box query is
    // coarse, so filter precisely by great-circle distance afterwards.
    if (center) {
      providers = providers.filter(
        (p) =>
          haversineKm(center!.lat, center!.lng, p.latitude / LAT_LNG_SCALE, p.longitude / LAT_LNG_SCALE) <=
          center!.radiusKm
      );
    }

    res.json(providers);
  })
);

providersRouter.get(
  '/providers/:id',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('GetProvider', req.params.id)
    );
    res.json(JSON.parse(Buffer.from(result).toString('utf8')));
  })
);

providersRouter.patch(
  '/providers/:id/status',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { status } = req.body as { status?: string };
    if (!status) throw new HttpError(400, 'status is required');

    await withContract(identity, (contract) =>
      contract.submitTransaction('UpdateProviderStatus', req.params.id, status)
    );
    res.status(204).send();
  })
);

providersRouter.get(
  '/providers/:id/slots',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('GetSlots', req.params.id)
    );
    res.json(JSON.parse(Buffer.from(result).toString('utf8')));
  })
);
