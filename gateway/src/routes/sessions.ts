import { Router } from 'express';
import { withContract } from '../fabric';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const sessionsRouter = Router();

sessionsRouter.post(
  '/sessions',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { reservationId } = req.body as { reservationId?: string };
    if (!reservationId) throw new HttpError(400, 'reservationId is required');

    const result = await withContract(identity, (contract) =>
      contract.submitTransaction('StartSession', reservationId)
    );
    res.status(201).json({ sessionId: Buffer.from(result).toString('utf8') });
  })
);

sessionsRouter.post(
  '/sessions/:id/complete',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { deliveredEnergy } = req.body as { deliveredEnergy?: number };
    if (deliveredEnergy === undefined) throw new HttpError(400, 'deliveredEnergy is required');

    await withContract(identity, (contract) =>
      contract.submitTransaction('CompleteSession', req.params.id, String(deliveredEnergy))
    );
    res.status(204).send();
  })
);

sessionsRouter.post(
  '/sessions/:id/dispute',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    await withContract(identity, (contract) =>
      contract.submitTransaction('DisputeSession', req.params.id)
    );
    res.status(204).send();
  })
);

sessionsRouter.get(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('GetSession', req.params.id)
    );
    res.json(JSON.parse(Buffer.from(result).toString('utf8')));
  })
);

// Not in the spec's REST list, but required by the frontend's
// reservation/session status view (section 11).
sessionsRouter.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { reservationId } = req.query as Record<string, string | undefined>;
    if (!reservationId) throw new HttpError(400, 'reservationId query parameter is required');

    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('QuerySessionsByReservation', reservationId)
    );
    res.json(JSON.parse(Buffer.from(result).toString('utf8')));
  })
);
