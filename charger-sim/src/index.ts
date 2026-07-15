import { AdminHandlers, startAdminServer } from './admin';
import { connectAsCharger } from './fabric';
import { computeIncrementWh } from './meter';
import { describeError } from './util';

const CHARGER_ID = process.env.CHARGER_ID;
if (!CHARGER_ID) {
  console.error('CHARGER_ID is required (must name a pre-enrolled charger identity, e.g. "charger1")');
  process.exit(1);
}

const READING_INTERVAL_MS = Number(process.env.READING_INTERVAL_MS) || 15_000;
const STOP_POLL_INTERVAL_MS = Number(process.env.STOP_POLL_INTERVAL_MS) || 3_000;
const ADMIN_PORT = Number(process.env.ADMIN_PORT) || 4001;

interface ActiveSession {
  sessionId: string;
  reservationId: string;
  cumulativeWh: number;
  lastTickAt: number;
}

interface ChargerRecord {
  chargerId: string;
  providerId: string;
  slotIndex: number;
  ratedPowerKw: number;
  status: string;
}

async function main(): Promise<void> {
  const { contract, close } = connectAsCharger(CHARGER_ID as string);

  let charger: ChargerRecord;
  try {
    const result = await contract.evaluateTransaction('GetCharger', CHARGER_ID as string);
    charger = JSON.parse(Buffer.from(result).toString('utf8'));
  } catch (err) {
    console.error(
      `failed to load charger '${CHARGER_ID}' from the ledger -- has it been registered via RegisterCharger / POST /chargers?`,
      err
    );
    close();
    process.exit(1);
    return;
  }
  console.log(
    `charger-sim '${charger.chargerId}' bound to provider ${charger.providerId} slot ${charger.slotIndex}, rated ${charger.ratedPowerKw}kW`
  );

  let active: ActiveSession | null = null;

  const evaluate = async (fn: string, ...args: string[]): Promise<string> =>
    Buffer.from(await contract.evaluateTransaction(fn, ...args)).toString('utf8');
  const submit = async (fn: string, ...args: string[]): Promise<string> =>
    Buffer.from(await contract.submitTransaction(fn, ...args)).toString('utf8');

  async function stopActive(reason: string): Promise<void> {
    if (!active) return;
    const sessionId = active.sessionId;
    active = null;
    try {
      await submit('StopSession', sessionId);
      console.log(`[${sessionId}] stopped (${reason})`);
    } catch (err) {
      console.error(`[${sessionId}] StopSession failed:`, describeError(err));
    }
  }

  const handlers: AdminHandlers = {
    async onPlugin(reservationId: string) {
      if (active) {
        throw new Error(`already charging session ${active.sessionId}; unplug first`);
      }
      const sessionId = await submit('StartSession', reservationId);
      active = { sessionId, reservationId, cumulativeWh: 0, lastTickAt: Date.now() };
      console.log(`[${sessionId}] plugged in, session started for reservation ${reservationId}`);
    },
    async onUnplug() {
      await stopActive('unplug');
    },
    getStatus() {
      return { chargerId: charger.chargerId, active };
    },
  };

  startAdminServer(ADMIN_PORT, handlers);

  // Every READING_INTERVAL_MS: advance the meter and record a reading. A
  // hold-cap rejection (RecordMeterReading rule 5) means the driver's
  // pre-authorization hold is exhausted -- the simulator treats that as the
  // signal to stop charging (Addendum A section 7, step 4).
  setInterval(async () => {
    if (!active) return;
    const now = Date.now();
    const incrementWh = computeIncrementWh(charger.ratedPowerKw, now - active.lastTickAt);
    const newCumulativeWh = active.cumulativeWh + incrementWh;
    try {
      await submit('RecordMeterReading', active.sessionId, String(newCumulativeWh));
      active.cumulativeWh = newCumulativeWh;
      active.lastTickAt = now;
      console.log(`[${active.sessionId}] recorded ${newCumulativeWh} Wh`);
    } catch (err) {
      console.log(`[${active.sessionId}] reading rejected (${describeError(err)}); stopping`);
      await stopActive('hold cap reached');
    }
  }, READING_INTERVAL_MS);

  // Every STOP_POLL_INTERVAL_MS: notice if the driver stopped the session
  // via the gateway (POST /sessions/:id/stop) so the simulator returns to
  // idle instead of continuing to tick against a Settled session
  // (Addendum A section 7, step 5).
  setInterval(async () => {
    if (!active) return;
    try {
      const sessionJSON = await evaluate('GetSession', active.sessionId);
      const session = JSON.parse(sessionJSON) as { state: string };
      if (session.state !== 'Active') {
        console.log(`[${active.sessionId}] left Active externally (state=${session.state}); going idle`);
        active = null;
      }
    } catch (err) {
      console.error('status poll failed:', describeError(err));
    }
  }, STOP_POLL_INTERVAL_MS);

  process.on('SIGINT', () => {
    close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('charger-sim failed to start:', err);
  process.exit(1);
});
