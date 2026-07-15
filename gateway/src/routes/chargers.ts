import { Router } from 'express';
import { withContract } from '../fabric';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const chargersRouter = Router();

// Provider owner registers/binds a pre-enrolled charger identity to one
// (providerId, slotIndex) pair. chargerId names that pre-enrolled identity
// (e.g. "charger1") -- necessary so the chaincode can later verify a
// charger-only call (StartSession/RecordMeterReading) against the binding;
// not listed as a body field in Addendum A section 8's route sketch but
// required by RegisterCharger's actual signature (section 3.1/section 2).
chargersRouter.post(
  '/chargers',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { providerId, slotIndex, ratedPowerKw, chargerId } = req.body as {
      providerId?: string;
      slotIndex?: number;
      ratedPowerKw?: number;
      chargerId?: string;
    };
    if (!providerId || slotIndex === undefined || !ratedPowerKw || !chargerId) {
      throw new HttpError(400, 'providerId, slotIndex, ratedPowerKw, and chargerId are required');
    }

    const payload = { chargerId, providerId, slotIndex, ratedPowerKw };
    const result = await withContract(identity, (contract) =>
      contract.submitTransaction('RegisterCharger', JSON.stringify(payload))
    );
    res.status(201).json({ chargerId: Buffer.from(result).toString('utf8') });
  })
);

chargersRouter.get(
  '/chargers/:id',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('GetCharger', req.params.id)
    );
    res.json(JSON.parse(Buffer.from(result).toString('utf8')));
  })
);

// Not in the spec's REST list, but required by the provider owner's charger
// management view to know which slots already have a bound charger.
chargersRouter.get(
  '/providers/:id/chargers',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('QueryChargersByProvider', req.params.id)
    );
    res.json(JSON.parse(Buffer.from(result).toString('utf8')));
  })
);
