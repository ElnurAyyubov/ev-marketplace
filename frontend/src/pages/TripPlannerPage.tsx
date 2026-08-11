import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { PlanConstraints, TripLegFailure, TripPlan, TripReserveResult } from '../api/types';
import { LocationPickerMap } from '../components/LocationPickerMap';
import { TripPlanMap } from '../components/TripPlanMap';
import { useIdentity } from '../context/IdentityContext';

interface Props {
  onSelectProvider: (providerId: string) => void;
}

type EndpointMode = 'text' | 'map';

const DEFAULT_LAT = 40.73;
const DEFAULT_LNG = -73.935;
const DEFAULT_ENERGY_PER_STOP_KWH = '20';
const MAX_REPLAN_ATTEMPTS = 3;

/**
 * The planner has no battery model (TRIP_PLANNER_ADDENDUM.md), so nothing
 * upstream knows how much energy a stop should deliver. TRIP_RESERVATION_ADDENDUM.md
 * doesn't specify this UI either, so this asks for one uniform amount applied
 * to every stop -- simplest thing that lets ReserveTripLegs' per-leg
 * requestedEnergyWh actually get filled in.
 */
function extractTripLegFailure(err: unknown): TripLegFailure | undefined {
  if (!(err instanceof ApiError) || err.status !== 409) return undefined;
  const body = err.body as Record<string, unknown> | null;
  if (
    body &&
    typeof body.failedLegIndex === 'number' &&
    typeof body.providerId === 'string' &&
    typeof body.reason === 'string'
  ) {
    return { failedLegIndex: body.failedLegIndex, providerId: body.providerId, reason: body.reason };
  }
  return undefined;
}

export function TripPlannerPage({ onSelectProvider }: Props) {
  const { identity } = useIdentity();

  const [originMode, setOriginMode] = useState<EndpointMode>('text');
  const [destMode, setDestMode] = useState<EndpointMode>('text');
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [originPin, setOriginPin] = useState({ lat: DEFAULT_LAT, lng: DEFAULT_LNG });
  const [destPin, setDestPin] = useState({ lat: DEFAULT_LAT + 1, lng: DEFAULT_LNG + 1 });

  const [maxLegKm, setMaxLegKm] = useState('300');
  const [type, setType] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [approvalRequired, setApprovalRequired] = useState<'' | 'true' | 'false'>('');

  const [nlQuery, setNlQuery] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [narration, setNarration] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const [energyPerStopKwh, setEnergyPerStopKwh] = useState(DEFAULT_ENERGY_PER_STOP_KWH);
  const [reserving, setReserving] = useState(false);
  const [reservePreview, setReservePreview] = useState<TripReserveResult | null>(null);
  const [reserveResult, setReserveResult] = useState<TripReserveResult | null>(null);
  const [reserveError, setReserveError] = useState<string | null>(null);

  const buildConstraints = (): PlanConstraints => ({
    providerType: type ? (type as PlanConstraints['providerType']) : undefined,
    maxPricePerkWh: maxPrice ? Number(maxPrice) : undefined,
    approvalRequired: approvalRequired === '' ? undefined : approvalRequired === 'true',
  });

  // Fills the structured fields in from an NL-resolved plan so the user can
  // see what was understood and adjust/resubmit, same pattern used by the
  // marketplace page's NL search.
  const applyPlanToForm = (p: TripPlan) => {
    setOriginMode('text');
    setDestMode('text');
    setOriginText(p.origin.label ?? `${p.origin.lat.toFixed(4)}, ${p.origin.lng.toFixed(4)}`);
    setDestText(p.destination.label ?? `${p.destination.lat.toFixed(4)}, ${p.destination.lng.toFixed(4)}`);
    setType(p.constraints.providerType ?? '');
    setMaxPrice(p.constraints.maxPricePerkWh !== undefined ? String(p.constraints.maxPricePerkWh) : '');
    setApprovalRequired(
      p.constraints.approvalRequired === undefined ? '' : p.constraints.approvalRequired ? 'true' : 'false'
    );
  };

  const planStructured = async () => {
    setError(null);
    setLoading(true);
    try {
      const origin = originMode === 'text' ? originText.trim() : originPin;
      const destination = destMode === 'text' ? destText.trim() : destPin;
      if (originMode === 'text' && !origin) throw new Error('origin is required');
      if (destMode === 'text' && !destination) throw new Error('destination is required');

      const result = await api.planTrip(identity, {
        origin,
        destination,
        maxLegKm: maxLegKm ? Number(maxLegKm) : undefined,
        constraints: buildConstraints(),
      });
      setPlan(result);
      setNarration(undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const planNl = async () => {
    if (!nlQuery.trim()) return;
    setError(null);
    setNlLoading(true);
    try {
      const { plan: result, narration: text } = await api.planTripNl(identity, nlQuery);
      setPlan(result);
      setNarration(text);
      applyPlanToForm(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setNlLoading(false);
    }
  };

  const buildLegs = (p: TripPlan) => {
    const requestedEnergyWh = Math.round(Number(energyPerStopKwh) * 1000);
    return p.stops.map((s) => ({
      providerId: s.providerId,
      location: s.location,
      requestedEnergyWh,
    }));
  };

  const previewReserve = async () => {
    if (!plan || plan.status !== 'feasible') return;
    setReserveError(null);
    setReserveResult(null);
    setReserving(true);
    try {
      const preview = await api.reserveTrip(identity, {
        legs: buildLegs(plan),
        origin: { lat: plan.origin.lat, lng: plan.origin.lng },
        dryRun: true,
      });
      setReservePreview(preview);
    } catch (err) {
      setReserveError((err as Error).message);
    } finally {
      setReserving(false);
    }
  };

  // §10: on a 409 for a specific leg, re-plan excluding that provider,
  // recompute the entire window array from departAt (never patch the failed
  // leg in place -- a swapped stop changes every subsequent leg's arrival
  // time), and resubmit. Capped at MAX_REPLAN_ATTEMPTS, then a clean failure
  // naming the contested stop.
  const confirmReserve = async () => {
    if (!plan || plan.status !== 'feasible') return;
    setReserving(true);
    setReserveError(null);

    let currentPlan = plan;
    const excluded: string[] = [];

    try {
      for (let attempt = 0; attempt <= MAX_REPLAN_ATTEMPTS; attempt++) {
        try {
          const result = await api.reserveTrip(identity, {
            legs: buildLegs(currentPlan),
            origin: { lat: currentPlan.origin.lat, lng: currentPlan.origin.lng },
            dryRun: false,
          });
          setPlan(currentPlan);
          setReserveResult(result);
          setReservePreview(null);
          return;
        } catch (err) {
          const failure = extractTripLegFailure(err);
          if (!failure || failure.failedLegIndex < 0 || attempt === MAX_REPLAN_ATTEMPTS) {
            throw err;
          }

          excluded.push(failure.providerId);
          const replanned = await api.planTrip(identity, {
            origin: currentPlan.origin,
            destination: currentPlan.destination,
            maxLegKm: currentPlan.maxLegKm,
            constraints: { ...currentPlan.constraints, excludeProviders: excluded },
          });
          if (replanned.status !== 'feasible') {
            throw new Error(
              `${failure.providerId} is no longer available (${failure.reason}), and no alternative route was found: ${
                replanned.reason ?? 'no feasible route'
              }`
            );
          }
          currentPlan = replanned;
        }
      }
    } catch (err) {
      setReserveError((err as Error).message);
    } finally {
      setReserving(false);
    }
  };

  const cancelPreview = () => {
    setReservePreview(null);
    setReserveError(null);
  };

  return (
    <div className="card">
      <h2>Trip Planner</h2>
      <p style={{ fontSize: 13, color: '#666', marginTop: -8 }}>
        Suggests charging stops between two points. Read-only and advisory -- it never reserves a slot; use a
        stop's provider page for that.
      </p>

      <div className="field">
        <label>Describe your trip</label>
        <div className="row">
          <input
            style={{ flex: 1 }}
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && planNl()}
            placeholder="e.g. Beşiktaş to İzmir, commercial only, under 25, no approval"
          />
          <button onClick={planNl} disabled={nlLoading}>
            {nlLoading ? 'Planning…' : 'Plan'}
          </button>
        </div>
      </div>

      <h3>Or use the form</h3>

      <div className="row">
        <div className="field">
          <label style={{ display: 'flex', justifyContent: 'space-between' }}>
            Origin
            <button
              className="secondary"
              style={{ padding: '2px 8px', fontSize: 12 }}
              onClick={() => setOriginMode(originMode === 'text' ? 'map' : 'text')}
            >
              {originMode === 'text' ? 'Use map pin' : 'Use place name'}
            </button>
          </label>
          {originMode === 'text' ? (
            <input
              value={originText}
              onChange={(e) => setOriginText(e.target.value)}
              placeholder="Place name"
            />
          ) : (
            <>
              <LocationPickerMap
                lat={originPin.lat}
                lng={originPin.lng}
                onChange={(lat, lng) => setOriginPin({ lat, lng })}
              />
              <small>
                {originPin.lat.toFixed(4)}, {originPin.lng.toFixed(4)}
              </small>
            </>
          )}
        </div>
        <div className="field">
          <label style={{ display: 'flex', justifyContent: 'space-between' }}>
            Destination
            <button
              className="secondary"
              style={{ padding: '2px 8px', fontSize: 12 }}
              onClick={() => setDestMode(destMode === 'text' ? 'map' : 'text')}
            >
              {destMode === 'text' ? 'Use map pin' : 'Use place name'}
            </button>
          </label>
          {destMode === 'text' ? (
            <input value={destText} onChange={(e) => setDestText(e.target.value)} placeholder="Place name" />
          ) : (
            <>
              <LocationPickerMap
                lat={destPin.lat}
                lng={destPin.lng}
                onChange={(lat, lng) => setDestPin({ lat, lng })}
              />
              <small>
                {destPin.lat.toFixed(4)}, {destPin.lng.toFixed(4)}
              </small>
            </>
          )}
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Any</option>
            <option value="Commercial">Commercial</option>
            <option value="Residential">Residential</option>
          </select>
        </div>
        <div className="field">
          <label>Max price</label>
          <input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} type="number" />
        </div>
        <div className="field">
          <label>Approval</label>
          <select
            value={approvalRequired}
            onChange={(e) => setApprovalRequired(e.target.value as '' | 'true' | 'false')}
          >
            <option value="">Any</option>
            <option value="false">No approval required</option>
            <option value="true">Approval required</option>
          </select>
        </div>
        <div className="field">
          <label>Max leg (km)</label>
          <input value={maxLegKm} onChange={(e) => setMaxLegKm(e.target.value)} type="number" />
        </div>
      </div>

      <button onClick={planStructured} disabled={loading}>
        {loading ? 'Planning…' : 'Plan trip'}
      </button>
      {error && <p className="error">{error}</p>}

      {plan && (
        <div style={{ marginTop: 16 }}>
          {plan.status === 'no_feasible_route' ? (
            <p className="error">No feasible route: {plan.reason}</p>
          ) : (
            <p>
              <strong>{plan.stopCount}</strong> stop{plan.stopCount === 1 ? '' : 's'} &middot;{' '}
              {plan.totalDistanceKm.toFixed(1)} km total
              {plan.etaMinutes !== undefined && <> &middot; ~{Math.round(plan.etaMinutes)} min</>}
            </p>
          )}

          {narration && (
            <p style={{ fontStyle: 'italic', background: '#f5f6f8', padding: 10, borderRadius: 6 }}>{narration}</p>
          )}

          <TripPlanMap plan={plan} />

          {plan.stops.map((s, i) => (
            <div key={s.providerId} className="provider-list-item" onClick={() => onSelectProvider(s.providerId)}>
              <div>
                <strong>
                  Stop {i + 1} &middot; {s.providerType}
                </strong>
                <br />
                <small>{s.approvalRequired ? 'Approval required' : 'No approval required'}</small>
              </div>
              <div>
                {s.pricePerkWh}/kWh &middot; leg {s.legDistanceKm.toFixed(1)} km
              </div>
            </div>
          ))}

          {plan.status === 'no_feasible_route' && plan.stops.length === 0 && (
            <p style={{ color: '#666' }}>No stops could be planned before the route dead-ended.</p>
          )}

          {plan.status === 'feasible' && plan.stops.length > 0 && (
            <div style={{ marginTop: 16, borderTop: '1px solid #e2e2e2', paddingTop: 16 }}>
              <h3>Reserve all stops</h3>
              <div className="field">
                <label>Energy per stop (kWh)</label>
                <input
                  style={{ maxWidth: 120 }}
                  type="number"
                  min="1"
                  value={energyPerStopKwh}
                  onChange={(e) => setEnergyPerStopKwh(e.target.value)}
                />
              </div>

              {!reservePreview && !reserveResult && (
                <button onClick={previewReserve} disabled={reserving}>
                  {reserving ? 'Checking availability…' : 'Reserve all stops'}
                </button>
              )}
              {reserveError && <p className="error">{reserveError}</p>}

              {reservePreview && (
                <div style={{ background: '#f5f6f8', padding: 10, borderRadius: 6 }}>
                  <p>
                    <strong>Total hold: {reservePreview.totalHold}</strong> &middot; window source:{' '}
                    {reservePreview.windowSource}
                  </p>
                  {reservePreview.windows.map((w, i) => (
                    <p key={`${w.providerId}-${w.slotIndex}`} style={{ margin: '4px 0' }}>
                      Stop {i + 1} ({w.providerId}, slot {w.slotIndex}): {new Date(w.windowStart * 1000).toLocaleString()} –{' '}
                      {new Date(w.windowEnd * 1000).toLocaleString()}
                    </p>
                  ))}
                  <div className="row">
                    <button onClick={confirmReserve} disabled={reserving}>
                      {reserving ? 'Booking…' : 'Confirm booking'}
                    </button>
                    <button className="secondary" onClick={cancelPreview} disabled={reserving}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {reserveResult && (
                <div style={{ background: '#eef8ee', padding: 10, borderRadius: 6 }}>
                  <p>
                    Booked {reserveResult.reservationIds.length} reservation
                    {reserveResult.reservationIds.length === 1 ? '' : 's'} &middot; total hold{' '}
                    {reserveResult.totalHold}.
                  </p>
                  <p style={{ fontSize: 13, color: '#666' }}>See My Reservations for status and cancellation.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
