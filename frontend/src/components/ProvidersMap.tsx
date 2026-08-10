import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import { ChargingProvider, LatLng } from '../api/types';

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

// Visually distinct from station pins (CAR_LOCATION_ADDENDUM.md section 6/L1
// acceptance) -- a green circular badge instead of a dark teardrop pin.
const carIcon = L.divIcon({
  className: 'car-marker-icon',
  html: `
    <div style="
      width: 30px; height: 30px; border-radius: 50%;
      background: #2ecc71; border: 2px solid #ffffff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; line-height: 1;
    ">🚗</div>
  `,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -12],
});

interface Props {
  providers: ChargingProvider[];
  onSelect: (providerId: string) => void;
  carLocation?: LatLng;
  // When set, clicking the map moves the car marker instead of doing
  // nothing -- used by MarketplacePage's "move my location" toggle.
  pickingLocation?: boolean;
  onPickLocation?: (lat: number, lng: number) => void;
}

// Geographic center of Turkey; react-leaflet only honors center/zoom on
// initial mount, so this is what's shown before providers ever load.
const TURKEY_CENTER: [number, number] = [38.9637, 35.2433];
const TURKEY_ZOOM = 6;

function CarPickHandler({ active, onPick }: { active: boolean; onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (active) onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function ProvidersMap({ providers, onSelect, carLocation, pickingLocation, onPickLocation }: Props) {
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
        {carLocation && (
          <Marker position={[carLocation.lat, carLocation.lng]} icon={carIcon}>
            <Popup>Your location</Popup>
          </Marker>
        )}
        {onPickLocation && <CarPickHandler active={!!pickingLocation} onPick={onPickLocation} />}
      </MapContainer>
    </div>
  );
}
