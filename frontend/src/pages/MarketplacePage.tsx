import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { ProvidersMap } from '../components/ProvidersMap';
import { VoiceFilterButton } from '../components/VoiceFilterButton';
import { useIdentity } from '../context/IdentityContext';
import { ChargingProvider, MyLocation, VoiceSearchResult } from '../api/types';
import { distanceKm } from '../lib/distance';

interface VoiceChip {
  id: 'type' | 'maxPrice' | 'approval' | 'radius';
  label: string;
}

interface Props {
  onSelectProvider: (providerId: string) => void;
}

const LAT_LNG_SCALE = 1_000_000;
const DEFAULT_WITHIN_KM = '2';

export function MarketplacePage({ onSelectProvider }: Props) {
  const { identity } = useIdentity();
  const [type, setType] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [approvalRequired, setApprovalRequired] = useState<'' | 'true' | 'false'>('');
  const [providers, setProviders] = useState<ChargingProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nlQuery, setNlQuery] = useState('');
  const [nlLoading, setNlLoading] = useState(false);

  // Voice search (VOICE_INPUT_ADDENDUM.md). transcript/chips are purely
  // presentational -- the fields they describe already live in the same
  // type/minPrice/maxPrice/approvalRequired/withinKm state the manual
  // filter UI and NL search share.
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceChips, setVoiceChips] = useState<VoiceChip[]>([]);

  // Driver's own off-ledger location (CAR_LOCATION_ADDENDUM.md). All
  // distance filtering below runs client-side against this value -- the
  // providers request itself never carries lat/lng/radiusKm (see the
  // invariant comment on api.queryProviders).
  const [carLocation, setCarLocation] = useState<MyLocation | null>(null);
  const [movingCar, setMovingCar] = useState(false);
  const [carLatInput, setCarLatInput] = useState('');
  const [carLngInput, setCarLngInput] = useState('');
  const [locationError, setLocationError] = useState<string | null>(null);

  const [withinKm, setWithinKm] = useState(DEFAULT_WITHIN_KM);
  const [sortByDistance, setSortByDistance] = useState(false);

  // Accepts overrides so searchNl() can run a query against freshly-parsed
  // filter values without waiting on the setState calls that populate the
  // visible inputs to land first.
  const search = async (overrides?: {
    type?: string;
    minPrice?: string;
    maxPrice?: string;
    approvalRequired?: '' | 'true' | 'false';
  }) => {
    const t = overrides?.type ?? type;
    const minP = overrides?.minPrice ?? minPrice;
    const maxP = overrides?.maxPrice ?? maxPrice;
    const appr = overrides?.approvalRequired ?? approvalRequired;
    setError(null);
    try {
      const results = await api.queryProviders(identity, {
        type: t || undefined,
        minPrice: minP ? Number(minP) : undefined,
        maxPrice: maxP ? Number(maxP) : undefined,
        approvalRequired: appr === '' ? undefined : appr === 'true',
      });
      setProviders(results);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Runs the prompt through Ollama to translate it into filter values, then
  // populates the same Type/Price/Approval inputs below (so the user can see
  // and adjust what was understood) and runs the normal deterministic search
  // with those values, instead of having the LLM filter results itself.
  const searchNl = async () => {
    if (!nlQuery.trim()) return;
    setError(null);
    setNlLoading(true);
    try {
      const { filters } = await api.parseNlFilters(identity, nlQuery);
      const nextType = filters.type ?? '';
      const nextMinPrice = filters.minPrice !== undefined ? String(filters.minPrice) : '';
      const nextMaxPrice = filters.maxPrice !== undefined ? String(filters.maxPrice) : '';
      const nextApproval: '' | 'true' | 'false' =
        filters.approvalRequired === undefined ? '' : filters.approvalRequired ? 'true' : 'false';

      setType(nextType);
      setMinPrice(nextMinPrice);
      setMaxPrice(nextMaxPrice);
      setApprovalRequired(nextApproval);

      await search({
        type: nextType,
        minPrice: nextMinPrice,
        maxPrice: nextMaxPrice,
        approvalRequired: nextApproval,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setNlLoading(false);
    }
  };

  // Populates the same four controls searchNl does, from a parsed voice
  // clip instead of typed text (VOICE_INPUT_ADDENDUM.md section 6). The
  // radius is applied to the existing client-side "within X km" filter
  // (withinKm/carLocation, CAR_LOCATION_ADDENDUM.md) rather than sent to
  // queryProviders -- radiusKm never leaves this component as a request
  // parameter, exactly like the manual "Within (km)" input already doesn't.
  const applyVoiceResult = async (result: VoiceSearchResult) => {
    setError(null);
    setVoiceTranscript(result.transcript);
    const { filters, nearbyApplied } = result;

    const nextType = filters.providerType ?? '';
    const nextMaxPrice = filters.maxPricePerkWh !== undefined ? String(filters.maxPricePerkWh) : '';
    const nextApproval: '' | 'true' | 'false' =
      filters.approvalRequired === undefined ? '' : filters.approvalRequired ? 'true' : 'false';

    setType(nextType);
    setMinPrice('');
    setMaxPrice(nextMaxPrice);
    setApprovalRequired(nextApproval);

    const chips: VoiceChip[] = [];
    if (filters.providerType) chips.push({ id: 'type', label: `Type: ${filters.providerType}` });
    if (filters.maxPricePerkWh !== undefined) {
      chips.push({ id: 'maxPrice', label: `Max price: ≤${filters.maxPricePerkWh}` });
    }
    if (filters.approvalRequired !== undefined) {
      chips.push({
        id: 'approval',
        label: `Approval: ${filters.approvalRequired ? 'required' : 'not required'}`,
      });
    }
    if (filters.radiusKm !== undefined) {
      if (!carLocation) {
        // Rule 2 (VOICE_INPUT_ADDENDUM.md section 3): "nearby" is undefined
        // without a map center. Don't guess one, and don't silently apply
        // the existing withinKm value as though a radius had been spoken.
        chips.push({ id: 'radius', label: 'nearby unavailable — showing all' });
      } else {
        setWithinKm(String(filters.radiusKm));
        chips.push({
          id: 'radius',
          label: nearbyApplied ? `nearby (${filters.radiusKm} km)` : `within ${filters.radiusKm} km`,
        });
      }
    }
    setVoiceChips(chips);

    await search({
      type: nextType,
      minPrice: '',
      maxPrice: nextMaxPrice,
      approvalRequired: nextApproval,
    });
  };

  const dismissVoiceChip = (id: VoiceChip['id']) => {
    setVoiceChips((chips) => chips.filter((c) => c.id !== id));
    if (id === 'type') setType('');
    else if (id === 'maxPrice') setMaxPrice('');
    else if (id === 'approval') setApprovalRequired('');
    else if (id === 'radius') setWithinKm(DEFAULT_WITHIN_KM);
  };

  const applyCarLocation = (loc: MyLocation) => {
    setCarLocation(loc);
    setCarLatInput(loc.lat.toFixed(4));
    setCarLngInput(loc.lng.toFixed(4));
  };

  useEffect(() => {
    search();
    api
      .getMyLocation(identity)
      .then(applyCarLocation)
      .catch((err) => setLocationError((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Updates local state immediately (marketplace re-filters live) and
  // persists via POST /me/location -- both file-backed, never sent to a
  // peer (CAR_LOCATION_ADDENDUM.md section 5).
  const moveCarTo = async (lat: number, lng: number) => {
    setLocationError(null);
    setCarLocation((prev) => ({ lat, lng, source: prev?.source ?? 'file' }));
    setCarLatInput(lat.toFixed(4));
    setCarLngInput(lng.toFixed(4));
    try {
      await api.setMyLocation(identity, lat, lng);
    } catch (err) {
      setLocationError((err as Error).message);
    }
  };

  const useBrowserLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not available in this browser -- set manually below.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => moveCarTo(pos.coords.latitude, pos.coords.longitude),
      () => setLocationError('Location permission denied -- set manually below.')
    );
  };

  const applyManualCarInput = () => {
    const lat = Number(carLatInput);
    const lng = Number(carLngInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setLocationError('Enter valid numbers for latitude and longitude.');
      return;
    }
    moveCarTo(lat, lng);
  };

  // Great-circle distance from the car to each result, computed entirely in
  // the browser (CAR_LOCATION_ADDENDUM.md section 7) -- provider coordinates
  // are on-ledger ints scaled by 1e6, so they're divided back down first.
  const providersWithDistance = useMemo(
    () =>
      providers.map((p) => ({
        provider: p,
        distanceKm: carLocation
          ? distanceKm(carLocation, { lat: p.latitude / LAT_LNG_SCALE, lng: p.longitude / LAT_LNG_SCALE })
          : undefined,
      })),
    [providers, carLocation]
  );

  const visibleProviders = useMemo(() => {
    const maxKm = withinKm.trim() === '' ? undefined : Number(withinKm);
    let list = providersWithDistance.filter(
      ({ distanceKm: d }) => maxKm === undefined || d === undefined || d <= maxKm
    );
    if (sortByDistance) {
      list = [...list].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    }
    return list;
  }, [providersWithDistance, withinKm, sortByDistance]);

  const hasActiveFilters =
    type !== '' ||
    minPrice !== '' ||
    maxPrice !== '' ||
    approvalRequired !== '' ||
    nlQuery !== '' ||
    voiceTranscript !== '' ||
    withinKm !== DEFAULT_WITHIN_KM ||
    sortByDistance;

  const clearFilters = () => {
    setNlQuery('');
    setVoiceTranscript('');
    setVoiceChips([]);
    setType('');
    setMinPrice('');
    setMaxPrice('');
    setApprovalRequired('');
    setWithinKm(DEFAULT_WITHIN_KM);
    setSortByDistance(false);
    setError(null);
    search({ type: '', minPrice: '', maxPrice: '', approvalRequired: '' });
  };

  return (
    <div className="card">
      <h2>Marketplace</h2>

      <div className="field">
        <label>Describe what you&apos;re looking for</label>
        <div className="row">
          <input
            style={{ flex: 1 }}
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchNl()}
            placeholder="e.g. cheap commercial charger, no approval, under 25"
          />
          <button onClick={searchNl} disabled={nlLoading}>
            {nlLoading ? 'Searching…' : 'Search'}
          </button>
          <VoiceFilterButton
            identity={identity}
            onResult={applyVoiceResult}
            onError={(message) => setError(message)}
          />
        </div>
        {voiceTranscript && (
          <div className="voice-result">
            <small>Heard: &ldquo;{voiceTranscript}&rdquo;</small>
            <div className="chip-row">
              {voiceChips.map((chip) => (
                <span key={chip.id} className="chip">
                  {chip.label}
                  <button type="button" className="chip-dismiss" onClick={() => dismissVoiceChip(chip.id)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
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
          <label>Min price</label>
          <input value={minPrice} onChange={(e) => setMinPrice(e.target.value)} type="number" />
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
      </div>

      <div className="field">
        <label style={{ display: 'flex', justifyContent: 'space-between' }}>
          My location
          {carLocation?.source === 'default' && (
            <small style={{ color: '#888', fontWeight: 400 }}>using default city center -- not yet set</small>
          )}
        </label>
        <div className="row">
          <input
            type="number"
            value={carLatInput}
            onChange={(e) => setCarLatInput(e.target.value)}
            placeholder="Latitude"
          />
          <input
            type="number"
            value={carLngInput}
            onChange={(e) => setCarLngInput(e.target.value)}
            placeholder="Longitude"
          />
          <button type="button" onClick={applyManualCarInput}>
            Set
          </button>
        </div>
        <div className="row">
          <button type="button" className="secondary" onClick={() => setMovingCar((m) => !m)}>
            {movingCar ? 'Click the map to place your car…' : 'Move on map'}
          </button>
          <button type="button" className="secondary" onClick={useBrowserLocation}>
            Use my location
          </button>
        </div>
        {locationError && <p className="error">{locationError}</p>}
      </div>

      <div className="row">
        <div className="field">
          <label>Within (km)</label>
          <input
            type="number"
            value={withinKm}
            onChange={(e) => setWithinKm(e.target.value)}
            placeholder="Any distance"
          />
        </div>
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={sortByDistance}
              onChange={(e) => setSortByDistance(e.target.checked)}
            />
            Sort by distance
          </label>
        </div>
      </div>

      <div className="row">
        <button onClick={() => search()}>Search</button>
        {hasActiveFilters && (
          <button onClick={clearFilters} type="button">
            Clear filters
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <h3>Results ({visibleProviders.length})</h3>
      <ProvidersMap
        providers={visibleProviders.map((v) => v.provider)}
        onSelect={onSelectProvider}
        carLocation={carLocation ?? undefined}
        pickingLocation={movingCar}
        onPickLocation={(lat, lng) => {
          moveCarTo(lat, lng);
          setMovingCar(false);
        }}
      />
      {visibleProviders.map(({ provider: p, distanceKm: d }) => (
        <div key={p.providerId} className="provider-list-item" onClick={() => onSelectProvider(p.providerId)}>
          <div>
            <strong>{p.locationLabel}</strong> — {p.providerType}
            <br />
            <small>{p.connectorTypes.join(', ')}</small>
          </div>
          <div>
            {p.pricePerkWh}/kWh · {p.currentAvailableSlots}/{p.numberOfSlots} free
            {d !== undefined && (
              <>
                <br />
                <small>{d.toFixed(1)} km away</small>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
