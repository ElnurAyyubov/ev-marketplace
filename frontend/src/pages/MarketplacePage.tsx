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
  const [useProximity, setUseProximity] = useState(false);
  const [lat, setLat] = useState(40.73);
  const [lng, setLng] = useState(-73.935);
  const [radiusKm, setRadiusKm] = useState(10);
  const [providers, setProviders] = useState<ChargingProvider[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setError(null);
    try {
      const results = await api.queryProviders(identity, {
        type: type || undefined,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        lat: useProximity ? lat : undefined,
        lng: useProximity ? lng : undefined,
        radiusKm: useProximity ? radiusKm : undefined,
      });
      setProviders(results);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card">
      <h2>Marketplace</h2>
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

      <button onClick={search}>Search</button>
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
