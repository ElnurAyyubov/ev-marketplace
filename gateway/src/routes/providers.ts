import { Router } from 'express';
import { withContract } from '../fabric';
import { boundingBoxSelector, haversineKm, LAT_LNG_SCALE } from '../geo';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const providersRouter = Router();

interface ChargingProvider {
  providerId: string;
  latitude: number;
  longitude: number;
  [key: string]: unknown;
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
    const { type, minPrice, maxPrice, lat, lng, radiusKm, ownerId, approvalRequired } =
      req.query as Record<string, string | undefined>;

    const selector: Record<string, unknown> = {};
    if (type) selector.providerType = type;
    // Not in the spec's query param list, but needed by the frontend's
    // provider-owner view ("my providers"); QueryProviders already accepts
    // an arbitrary Mango selector so this is a passthrough, not a chaincode change.
    if (ownerId) selector.ownerId = ownerId;
    // Public/marketplace-style queries (no ownerId) only ever want bookable
    // stations; the owner's own "my providers" view needs to see Inactive/
    // Deleted ones too, so it's exempt.
    else selector.status = 'Active';
    if (approvalRequired !== undefined) selector.approvalRequired = approvalRequired === 'true';
    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceRange: Record<string, number> = {};
      if (minPrice !== undefined) priceRange.$gte = Number(minPrice);
      if (maxPrice !== undefined) priceRange.$lte = Number(maxPrice);
      selector.pricePerkWh = priceRange;
    }

    let center: { lat: number; lng: number; radiusKm: number } | undefined;
    if (lat !== undefined && lng !== undefined && radiusKm !== undefined) {
      center = { lat: Number(lat), lng: Number(lng), radiusKm: Number(radiusKm) };
      Object.assign(selector, boundingBoxSelector(center));
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

providersRouter.delete(
  '/providers/:id',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    await withContract(identity, (contract) =>
      contract.submitTransaction('DeleteProvider', req.params.id)
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
