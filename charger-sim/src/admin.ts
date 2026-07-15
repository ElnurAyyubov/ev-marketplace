import express from 'express';
import { describeError } from './util';

/** Local trigger endpoints simulating physical plug-in/unplug events (Addendum A section 7, step 2). */
export interface AdminHandlers {
  onPlugin(reservationId: string): Promise<void>;
  onUnplug(): Promise<void>;
  getStatus(): unknown;
}

export function startAdminServer(port: number, handlers: AdminHandlers): void {
  const app = express();
  app.use(express.json());

  app.get('/sim/status', (_req, res) => {
    res.json(handlers.getStatus() ?? { active: false });
  });

  app.post('/sim/plugin', async (req, res) => {
    const { reservationId } = req.body as { reservationId?: string };
    if (!reservationId) {
      res.status(400).json({ error: 'reservationId is required' });
      return;
    }
    try {
      await handlers.onPlugin(reservationId);
      res.status(204).send();
    } catch (err) {
      res.status(400).json({ error: describeError(err) });
    }
  });

  app.post('/sim/unplug', async (_req, res) => {
    try {
      await handlers.onUnplug();
      res.status(204).send();
    } catch (err) {
      res.status(400).json({ error: describeError(err) });
    }
  });

  app.listen(port, () => {
    console.log(`charger-sim admin endpoint listening on http://localhost:${port}`);
  });
}
