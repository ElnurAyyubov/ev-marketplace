import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import { ChargingProvider } from '../api/types';

interface Props {
  providers: ChargingProvider[];
  onSelect: (providerId: string) => void;
}

export function ProvidersMap({ providers, onSelect }: Props) {
  const center: [number, number] =
    providers.length > 0
      ? [providers[0].latitude / 1_000_000, providers[0].longitude / 1_000_000]
      : [40.7306, -73.9352];

  return (
    <div className="map-container">
      <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {providers.map((p) => (
          <Marker
            key={p.providerId}
            position={[p.latitude / 1_000_000, p.longitude / 1_000_000]}
            eventHandlers={{ click: () => onSelect(p.providerId) }}
          >
            <Popup>
              <strong>{p.locationLabel}</strong>
              <br />
              {p.providerType} · {p.pricePerkWh}/kWh
              <br />
              {p.currentAvailableSlots}/{p.numberOfSlots} slots free
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
