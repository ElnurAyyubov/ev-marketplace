import { Router } from 'express';
import { withContract, withTransientContract } from '../fabric';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const reservationsRouter = Router();

reservationsRouter.post(
  '/reservations',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { providerId, slotId, requestedEnergy } = req.body as {
      providerId?: string;
      slotId?: string;
      requestedEnergy?: number;
    };
    if (!providerId || slotId === undefined || !requestedEnergy) {
      throw new HttpError(400, 'providerId, slotId, and requestedEnergy are required');
    }

    // providerId/slotId identify where the driver will be, so they travel as
    // transient data, never as a regular argument (TRIP_RESERVATION_ADDENDUM.md
    // section 7.3) -- a regular argument lands in the block in cleartext.
    const result = await withTransientContract(identity, (contract) =>
      contract.submit('CreateReservation', {
        arguments: [String(requestedEnergy)],
        transientData: { leg: JSON.stringify({ providerId, slotId: String(slotId) }) },
      })
    );
    res.status(201).json({ reservationId: Buffer.from(result).toString('utf8') });
  })
);

reservationsRouter.post(
  '/reservations/:id/approve',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    await withContract(identity, (contract) =>
      contract.submitTransaction('ApproveReservation', req.params.id)
    );
    res.status(204).send();
  })
);

reservationsRouter.post(
  '/reservations/:id/cancel',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    await withContract(identity, (contract) =>
      contract.submitTransaction('CancelReservation', req.params.id)
    );
    res.status(204).send();
  })
);

reservationsRouter.get(
  '/reservations/:id',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('GetReservation', req.params.id)
    );
    res.json(JSON.parse(Buffer.from(result).toString('utf8')));
  })
);

// Not in the spec's REST list, but required by the frontend's driver and
// provider-owner reservation views (section 11); see reservations.go's
// QueryReservationsByDriver/QueryReservationsByProvider.
reservationsRouter.get(
  '/reservations',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { driverId, providerId } = req.query as Record<string, string | undefined>;
    if (!driverId && !providerId) {
      throw new HttpError(400, 'driverId or providerId query parameter is required');
    }

    const result = await withContract(identity, (contract) =>
      driverId
        ? contract.evaluateTransaction('QueryReservationsByDriver', driverId)
        : contract.evaluateTransaction('QueryReservationsByProvider', providerId as string)
    );
    res.json(JSON.parse(Buffer.from(result).toString('utf8')));
  })
);
