import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PlanConstraints, TripPlan } from '../api/types';
import { LocationPickerMap } from '../components/LocationPickerMap';
import { TripPlanMap } from '../components/TripPlanMap';
import { useIdentity } from '../context/IdentityContext';

interface Props {
  onSelectProvider: (providerId: string) => void;
}

type EndpointMode = 'text' | 'map';

const DEFAULT_LAT = 41.0082;
const DEFAULT_LNG = 28.9784;

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

  // CAR_LOCATION_ADDENDUM.md section 3/L3: pre-fill the origin from the
  // driver's own off-ledger location, treated as a map pin -- this never
  // triggers a geocode call for the origin.
  useEffect(() => {
    api
      .getMyLocation(identity)
      .then((loc) => {
        setOriginPin({ lat: loc.lat, lng: loc.lng });
        setOriginMode('map');
      })
      .catch(() => {
        /* best-effort prefill; text/manual-pin entry still works */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        </div>
      )}
    </div>
  );
}
