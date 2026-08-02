import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import { ChargingProvider } from '../api/types';

// The default Leaflet marker PNGs don't resolve reliably through Vite's
// bundler, so use a self-contained inline SVG pin instead of asset URLs.
const providerPin = L.divIcon({
  className: 'location-pin-icon',
  html: `
    <svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0C7.163 0 0 7.163 0 16c0 11 16 26 16 26s16-15 16-26c0-8.837-7.163-16-16-16z"
            fill="#1a2b3c" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="16" cy="16" r="6" fill="#ffffff"/>
    </svg>
  `,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  popupAnchor: [0, -38],
});

interface Props {
  providers: ChargingProvider[];
  onSelect: (providerId: string) => void;
}

// Geographic center of Turkey; react-leaflet only honors center/zoom on
// initial mount, so this is what's shown before providers ever load.
const TURKEY_CENTER: [number, number] = [38.9637, 35.2433];
const TURKEY_ZOOM = 6;

export function ProvidersMap({ providers, onSelect }: Props) {
  return (
    <div className="map-container">
      <MapContainer center={TURKEY_CENTER} zoom={TURKEY_ZOOM} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {providers.map((p) => (
          <Marker
            key={p.providerId}
            position={[p.latitude / 1_000_000, p.longitude / 1_000_000]}
            icon={providerPin}
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
