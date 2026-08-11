import { TripPlan } from '../api/types';
import { TripPlanMap } from '../components/TripPlanMap';
import { CarMarker } from './CarMarker';
import { DemoControlBar } from './DemoControlBar';
import { useDemoRunner } from './useDemoRunner';

interface Props {
  plan: TripPlan;
}

/**
 * The whole demo section -- map, animated car, and controls -- as one
 * conditionally-mounted unit (DEMO_RUNNER_ADDENDUM.md section 2.2/2.3).
 * TripPlannerPage renders this only when VITE_ENABLE_DEV_DEMO is set, so
 * this component and everything it imports (useDemoRunner, DemoControlBar,
 * CarMarker) is dead code Rollup can drop from a production build when the
 * flag is off, rather than a hook that always runs and only its render
 * output being gated.
 */
export function DemoTripSection({ plan }: Props) {
  const runner = useDemoRunner(plan);

  return (
    <>
      <TripPlanMap plan={plan} overlay={runner.carPosition ? <CarMarker position={runner.carPosition} /> : undefined} />
      <DemoControlBar runner={runner} stopCount={plan.stops.length} />
    </>
  );
}
