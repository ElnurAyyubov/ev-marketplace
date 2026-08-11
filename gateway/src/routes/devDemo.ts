/**
 * Dev-only demo proxy routes (DEMO_RUNNER_ADDENDUM.md section 7). Mounted
 * only when ENABLE_DEV_DEMO is set (gateway/src/index.ts) -- with the flag
 * unset, every route under here 404s via Express's default handler.
 *
 * charger-sim's admin port (section 3.2 step 3, section 7) is not reachable
 * from the browser and doesn't exist inside the self-provisioning car
 * containers, so /plugin and /unplug proxy to it. The car's position itself
 * never passes through here or any other server -- it stays entirely
 * client-side (section 7), preserving CAR_LOCATION_ADDENDUM.md's invariant
 * for the simulated car the same way it already holds for the real one.
 */
import * as fs from 'fs';
import { Router } from 'express';
import { REPO_ROOT, withTransientContract } from '../fabric';
import { asyncHandler, HttpError } from './util';

export const devDemoRouter = Router();

const MANIFEST_PATH = process.env.DEMO_CHARGER_MANIFEST || `${REPO_ROOT}/.run/demo-chargers.json`;

/**
 * chargerId -> charger-sim admin port. Written by scripts/demo-seed.sh once
 * it knows which sim is listening on which port; read fresh on every
 * request since this is a dev-only file that can change between seed runs
 * without a gateway restart.
 */
function loadChargerManifest(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

function portFor(chargerId: string): number {
  const port = loadChargerManifest()[chargerId];
  if (!port) {
    throw new HttpError(404, `no running charger-sim known for '${chargerId}' -- has scripts/demo-seed.sh been run?`);
  }
  return port;
}

async function proxyToSim(port: number, path: string, body: unknown): Promise<void> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    // charger-sim's admin API already unwraps the real chaincode rejection
    // (charger-sim/src/util.ts's describeError) into { error }; propagate
    // that message as-is rather than nesting it inside a stringified body,
    // so a frontend caller matching on its text (e.g. the demo runner's
    // "cannot start before its window" retry check) sees it directly.
    const detail = await res
      .json()
      .then((parsed: unknown) => {
        const error = (parsed as { error?: unknown } | null)?.error;
        return typeof error === 'string' ? error : JSON.stringify(parsed);
      })
      .catch(() => res.statusText);
    throw new HttpError(res.status, detail);
  }
}

devDemoRouter.get('/dev/demo/enabled', (_req, res) => {
  res.json({ enabled: true });
});

devDemoRouter.post(
  '/dev/demo/plugin',
  asyncHandler(async (req, res) => {
    const { chargerId, reservationId } = req.body as { chargerId?: string; reservationId?: string };
    if (!chargerId || !reservationId) {
      throw new HttpError(400, 'chargerId and reservationId are required');
    }
    await proxyToSim(portFor(chargerId), '/sim/plugin', { reservationId });
    res.status(204).send();
  })
);

devDemoRouter.post(
  '/dev/demo/unplug',
  asyncHandler(async (req, res) => {
    const { chargerId } = req.body as { chargerId?: string };
    if (!chargerId) {
      throw new HttpError(400, 'chargerId is required');
    }
    await proxyToSim(portFor(chargerId), '/sim/unplug', {});
    res.status(204).send();
  })
);

// D5 (DEMO_RUNNER_ADDENDUM.md section 8): books a bucket out from under a
// planned stop, as a second driver identity, so the real driver's own
// ReserveTripLegs call for the same slot/window gets TRIP_LEG_CONFLICT and
// the frontend's existing 409 re-plan loop (TRIP_RESERVATION_ADDENDUM.md
// section 10) takes over -- real behaviour, not a demo-only path. Uses a
// minimal requestedEnergyWh; all that matters is claiming the same bucket.
const CONFLICT_DRIVER_IDENTITY = process.env.DEMO_CONFLICT_DRIVER || 'demo-driver-2';
const CONFLICT_ENERGY_WH = 1000;

devDemoRouter.post(
  '/dev/demo/conflict',
  asyncHandler(async (req, res) => {
    const { providerId, slotIndex, windowStart } = req.body as {
      providerId?: string;
      slotIndex?: number;
      windowStart?: number;
    };
    if (!providerId || slotIndex === undefined || windowStart === undefined) {
      throw new HttpError(400, 'providerId, slotIndex, and windowStart are required');
    }

    const publicLegsJSON = JSON.stringify([CONFLICT_ENERGY_WH]);
    const privateLegsJSON = JSON.stringify([{ providerId, slotIndex, windowStart }]);

    await withTransientContract(CONFLICT_DRIVER_IDENTITY, (contract) =>
      contract.submit('ReserveTripLegs', {
        arguments: [publicLegsJSON],
        transientData: { legs: privateLegsJSON },
      })
    );
    res.status(204).send();
  })
);
