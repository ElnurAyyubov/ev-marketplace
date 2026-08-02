import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ProvidersMap } from '../components/ProvidersMap';
import { useIdentity } from '../context/IdentityContext';
import { ChargingProvider } from '../api/types';

interface Props {
  onSelectProvider: (providerId: string) => void;
}

export function MarketplacePage({ onSelectProvider }: Props) {
  const { identity } = useIdentity();
  const [type, setType] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [approvalRequired, setApprovalRequired] = useState<'' | 'true' | 'false'>('');
  const [useProximity, setUseProximity] = useState(false);
  const [lat, setLat] = useState(40.73);
  const [lng, setLng] = useState(-73.935);
  const [radiusKm, setRadiusKm] = useState(10);
  const [providers, setProviders] = useState<ChargingProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nlQuery, setNlQuery] = useState('');
  const [nlLoading, setNlLoading] = useState(false);

  // Accepts overrides so searchNl() can run a query against freshly-parsed
  // filter values without waiting on the setState calls that populate the
  // visible inputs to land first.
  const search = async (overrides?: {
    type?: string;
    minPrice?: string;
    maxPrice?: string;
    approvalRequired?: '' | 'true' | 'false';
    useProximity?: boolean;
  }) => {
    const t = overrides?.type ?? type;
    const minP = overrides?.minPrice ?? minPrice;
    const maxP = overrides?.maxPrice ?? maxPrice;
    const appr = overrides?.approvalRequired ?? approvalRequired;
    const proximity = overrides?.useProximity ?? useProximity;
    setError(null);
    try {
      const results = await api.queryProviders(identity, {
        type: t || undefined,
        minPrice: minP ? Number(minP) : undefined,
        maxPrice: maxP ? Number(maxP) : undefined,
        approvalRequired: appr === '' ? undefined : appr === 'true',
        lat: proximity ? lat : undefined,
        lng: proximity ? lng : undefined,
        radiusKm: proximity ? radiusKm : undefined,
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

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasActiveFilters =
    type !== '' ||
    minPrice !== '' ||
    maxPrice !== '' ||
    approvalRequired !== '' ||
    useProximity ||
    nlQuery !== '';

  const clearFilters = () => {
    setNlQuery('');
    setType('');
    setMinPrice('');
    setMaxPrice('');
    setApprovalRequired('');
    setUseProximity(false);
    setLat(40.73);
    setLng(-73.935);
    setRadiusKm(10);
    setError(null);
    search({ type: '', minPrice: '', maxPrice: '', approvalRequired: '', useProximity: false });
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={useProximity}
            onChange={(e) => setUseProximity(e.target.checked)}
          />
          Filter by proximity
        </label>
      </div>
      {useProximity && (
        <div className="row">
          <div className="field">
            <label>Latitude</label>
            <input type="number" value={lat} onChange={(e) => setLat(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Longitude</label>
            <input type="number" value={lng} onChange={(e) => setLng(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Radius (km)</label>
            <input
              type="number"
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
            />
          </div>
        </div>
      )}

      <div className="row">
        <button onClick={() => search()}>Search</button>
        {hasActiveFilters && (
          <button onClick={clearFilters} type="button">
            Clear filters
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <h3>Results ({providers.length})</h3>
      <ProvidersMap providers={providers} onSelect={onSelectProvider} />
      {providers.map((p) => (
        <div key={p.providerId} className="provider-list-item" onClick={() => onSelectProvider(p.providerId)}>
          <div>
            <strong>{p.locationLabel}</strong> — {p.providerType}
            <br />
            <small>{p.connectorTypes.join(', ')}</small>
          </div>
          <div>
            {p.pricePerkWh}/kWh · {p.currentAvailableSlots}/{p.numberOfSlots} free
          </div>
        </div>
      ))}
    </div>
  );
}
