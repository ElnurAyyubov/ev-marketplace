import { FormEvent, useState } from 'react';
import { api } from '../api/client';
import { LocationPickerMap } from '../components/LocationPickerMap';
import { useIdentity } from '../context/IdentityContext';
import { ProviderType } from '../api/types';

const CONNECTOR_OPTIONS = ['Type2', 'CCS', 'CHAdeMO', 'Tesla'];

export function CreateProviderPage() {
  const { identity } = useIdentity();
  const [providerType, setProviderType] = useState<ProviderType>('Commercial');
  const [lat, setLat] = useState(40.7306);
  const [lng, setLng] = useState(-73.9352);
  const [locationLabel, setLocationLabel] = useState('');
  const [pricePerkWh, setPricePerkWh] = useState(10);
  const [availableEnergy, setAvailableEnergy] = useState(100);
  const [numberOfSlots, setNumberOfSlots] = useState(1);
  const [connectorTypes, setConnectorTypes] = useState<string[]>(['Type2']);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTypeChange = (type: ProviderType) => {
    setProviderType(type);
    if (type === 'Residential') {
      setNumberOfSlots(1);
      setApprovalRequired(true);
    }
  };

  const toggleConnector = (connector: string) => {
    setConnectorTypes((prev) =>
      prev.includes(connector) ? prev.filter((c) => c !== connector) : [...prev, connector]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const { providerId } = await api.createProvider(identity, {
        providerType,
        lat,
        lng,
        locationLabel,
        pricePerkWh,
        availableEnergy,
        numberOfSlots,
        connectorTypes,
        approvalRequired,
      });
      setResult(`Created provider ${providerId}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="card">
      <h2>Register a Charging Provider</h2>
      <p>
        Owner will be <strong>{identity}</strong>.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Provider type</label>
          <div className="row">
            <button
              type="button"
              className={providerType === 'Commercial' ? '' : 'secondary'}
              onClick={() => handleTypeChange('Commercial')}
            >
              Commercial
            </button>
            <button
              type="button"
              className={providerType === 'Residential' ? '' : 'secondary'}
              onClick={() => handleTypeChange('Residential')}
            >
              Residential
            </button>
          </div>
        </div>

        <div className="field">
          <label>Location (click the map to set)</label>
          <LocationPickerMap
            lat={lat}
            lng={lng}
            onChange={(newLat, newLng) => {
              setLat(newLat);
              setLng(newLng);
            }}
          />
          <span>
            lat: {lat.toFixed(5)}, lng: {lng.toFixed(5)}
          </span>
        </div>

        <div className="field">
          <label>Location label</label>
          <input
            value={locationLabel}
            onChange={(e) => setLocationLabel(e.target.value)}
            placeholder="e.g. Downtown Fast Charge"
            required
          />
        </div>

        <div className="row">
          <div className="field">
            <label>Price per kWh</label>
            <input
              type="number"
              value={pricePerkWh}
              onChange={(e) => setPricePerkWh(Number(e.target.value))}
              min={0}
              required
            />
          </div>
          <div className="field">
            <label>Available energy (kWh)</label>
            <input
              type="number"
              value={availableEnergy}
              onChange={(e) => setAvailableEnergy(Number(e.target.value))}
              min={0}
            />
          </div>
        </div>

        {providerType === 'Commercial' && (
          <div className="field">
            <label>Number of slots</label>
            <input
              type="number"
              value={numberOfSlots}
              onChange={(e) => setNumberOfSlots(Number(e.target.value))}
              min={1}
              required
            />
          </div>
        )}

        <div className="field">
          <label>Connector types</label>
          <div className="row">
            {CONNECTOR_OPTIONS.map((c) => (
              <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={connectorTypes.includes(c)}
                  onChange={() => toggleConnector(c)}
                />
                {c}
              </label>
            ))}
          </div>
        </div>

        {providerType === 'Residential' && (
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={approvalRequired}
                onChange={(e) => setApprovalRequired(e.target.checked)}
              />
              Require my approval before a reservation is confirmed
            </label>
          </div>
        )}

        <button type="submit">Register Provider</button>
      </form>
      {result && <p>{result}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
