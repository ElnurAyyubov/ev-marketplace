import { Router } from 'express';
import { withContract } from '../fabric';
import { asyncHandler, HttpError, requireIdentity } from './util';

export const sessionsRouter = Router();

// Sessions are charger-initiated (Addendum A section 3.2/9): StartSession is
// invoked directly by the charger-sim daemon using the bound charger's own
// Fabric identity, not through this REST API. There is no POST /sessions
// here by design.

sessionsRouter.post(
  '/sessions/:id/stop',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    await withContract(identity, (contract) => contract.submitTransaction('StopSession', req.params.id));
    res.status(204).send();
  })
);

sessionsRouter.post(
  '/sessions/:id/malfunction',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const { note } = req.body as { note?: string };
    await withContract(identity, (contract) =>
      contract.submitTransaction('FlagChargerMalfunction', req.params.id, note ?? '')
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

// Live ticker / audit view: all readings for a session, ascending seq order.
sessionsRouter.get(
  '/sessions/:id/readings',
  asyncHandler(async (req, res) => {
    const identity = requireIdentity(req);
    const result = await withContract(identity, (contract) =>
      contract.evaluateTransaction('GetSessionReadings', req.params.id)
    );
    res.json(JSON.parse(Buffer.from(result).toString('utf8')));
  })
);

// Not in the spec's REST list, but required by the frontend's
// reservation/session status view (base spec section 11).
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
