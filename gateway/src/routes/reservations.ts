import { Router } from 'express';
import { withContract } from '../fabric';
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

    const result = await withContract(identity, (contract) =>
      contract.submitTransaction(
        'CreateReservation',
        providerId,
        String(slotId),
        String(requestedEnergy)
      )
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
