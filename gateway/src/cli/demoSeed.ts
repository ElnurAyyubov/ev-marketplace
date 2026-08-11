// Demo topology seeding/reset (DEMO_RUNNER_ADDENDUM.md section 5). Not part
// of the HTTP gateway -- ResetMarketplaceData/RegisterProvider/RegisterCharger
// are called directly against the peer, the same direct-connection pattern
// cli/faucet.ts uses for Mint, so this works with no gateway process running.
//
// Usage:
//   npx tsx src/cli/demoSeed.ts seed [stopCount]   # default stopCount: 3
//   npx tsx src/cli/demoSeed.ts reset
//
// `seed` prints one pipe-delimited line per stop to stdout
// (chargerId|providerId|locationLabel), the same delimited-error-shape
// convention ReserveTripLegs already uses (TRIP_RESERVATION_ADDENDUM.md
// section 4.2) -- scripts/demo-seed.sh reads these to enroll charger
// identities, launch charger-sim processes, and write the chargerId ->
// ADMIN_PORT manifest devDemo.ts reads. No jq dependency needed.
import { GatewayError } from '@hyperledger/fabric-gateway';
import { LAT_LNG_SCALE } from '../geo';
import { withContract } from '../fabric';
import { unwrapChaincodeMessage } from '../routes/util';

/**
 * A bare GatewayError's .message is just the generic gRPC status ("10
 * ABORTED: failed to endorse transaction..."); the actual chaincode
 * rejection reason is per-peer in .details. Mirrors
 * gateway/src/routes/util.ts's errorMiddleware and charger-sim/src/util.ts's
 * describeError so this CLI surfaces the real cause too.
 */
function describeError(err: unknown): string {
  if (err instanceof GatewayError && err.details.length > 0) {
    return err.details.map((detail) => unwrapChaincodeMessage(detail.message)).join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}

const ADMIN_IDENTITY = 'minteradmin'; // Constants.ADMIN_IDENTITY -- ResetMarketplaceData/Mint are gated to this identity.
const OWNER_IDENTITY = 'admin'; // RegisterProvider/RegisterCharger accept any caller; reuse the identity every dev setup already enrolls.

// Real towns along the Istanbul -> Ankara highway corridor (the same route
// DEMO_RUNNER_ADDENDUM.md section 4's worked example narrates), west to
// east, so a trip planned Istanbul -> Ankara has somewhere real to stop.
const CORRIDOR = [
  { name: 'izmit', lat: 40.7654, lng: 29.9408 },
  { name: 'bolu', lat: 40.7734, lng: 31.6084 },
  { name: 'gerede', lat: 40.7997, lng: 32.2058 },
];

const DEMO_PRICE_PER_KWH = 12;
const DEMO_RATED_POWER_KW = 1000; // DEMO_RUNNER_ADDENDUM.md section 1: admits ~20kWh in ~72s under the real rate cap.

async function resetMarketplace(): Promise<void> {
  await withContract(ADMIN_IDENTITY, (contract) => contract.submitTransaction('ResetMarketplaceData'));
}

async function registerProvider(stop: { name: string; lat: number; lng: number }): Promise<string> {
  // providerId is chaincode-generated ("provider-" + txId) -- RegisterProvider
  // has no client-chosen-id field, so demo-p-* namespacing (addendum section 5)
  // happens via locationLabel instead, which the addendum's section 6
  // mitigation (greppable, obviously-synthetic demo data) only needs anyway.
  const locationLabel = `demo-p-${stop.name}`;
  const payload = {
    providerType: 'Commercial',
    latitude: Math.round(stop.lat * LAT_LNG_SCALE),
    longitude: Math.round(stop.lng * LAT_LNG_SCALE),
    locationLabel,
    pricePerkWh: DEMO_PRICE_PER_KWH,
    availableEnergy: 1_000_000,
    numberOfSlots: 1,
    connectorTypes: ['Type2'],
    approvalRequired: false, // required for trip booking eligibility, TRIP_RESERVATION_ADDENDUM.md section 5
    ipfsHash: '',
  };
  const result = await withContract(OWNER_IDENTITY, (contract) =>
    contract.submitTransaction('RegisterProvider', JSON.stringify(payload))
  );
  return Buffer.from(result).toString('utf8');
}

async function registerCharger(chargerId: string, providerId: string, slotIndex: number): Promise<void> {
  const payload = { chargerId, providerId, slotIndex, ratedPowerKw: DEMO_RATED_POWER_KW };
  await withContract(OWNER_IDENTITY, (contract) => contract.submitTransaction('RegisterCharger', JSON.stringify(payload)));
}

async function seed(stopCount: number): Promise<void> {
  const stops = CORRIDOR.slice(0, stopCount);
  if (stops.length < stopCount) {
    throw new Error(`only ${CORRIDOR.length} corridor stops are defined; asked for ${stopCount}`);
  }

  await resetMarketplace();

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const providerId = await registerProvider(stop);
    const chargerId = `demo-charger-${i + 1}`;
    await registerCharger(chargerId, providerId, 0);
    console.log(`${chargerId}|${providerId}|demo-p-${stop.name}`);
  }
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'reset') {
    await resetMarketplace();
    console.error('marketplace data reset');
    return;
  }
  if (cmd === 'seed') {
    const stopCount = arg ? Number(arg) : 3;
    await seed(stopCount);
    return;
  }
  console.error('usage: demoSeed.ts seed [stopCount] | demoSeed.ts reset');
  process.exit(1);
}

main().catch((err) => {
  console.error(describeError(err));
  process.exit(1);
});
