import L from 'leaflet';
import { ReactNode } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet';
import { TripPlan } from '../api/types';

// Inline SVG pins (same approach as LocationPickerMap -- Vite doesn't
// reliably resolve Leaflet's default marker PNGs).
function pin(fill: string, label?: string) {
  return L.divIcon({
    className: 'location-pin-icon',
    html: `
      <svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C7.163 0 0 7.163 0 16c0 11 16 26 16 26s16-15 16-26c0-8.837-7.163-16-16-16z"
              fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>
        ${
          label
            ? `<text x="16" y="21" text-anchor="middle" font-size="13" font-weight="700" fill="#ffffff">${label}</text>`
            : '<circle cx="16" cy="16" r="6" fill="#ffffff"/>'
        }
      </svg>
    `,
    iconSize: [32, 42],
    iconAnchor: [16, 42],
    popupAnchor: [0, -38],
  });
}

const originPin = pin('#2ecc71');
const destinationPin = pin('#b00020');

interface Props {
  plan: TripPlan;
  overlay?: ReactNode;
}

export function TripPlanMap({ plan, overlay }: Props) {
  const path: [number, number][] = plan.roadGeometry
    ? plan.roadGeometry.map((p) => [p.lat, p.lng])
    : [
        [plan.origin.lat, plan.origin.lng],
        ...plan.stops.map((s): [number, number] => [s.location.lat, s.location.lng]),
        [plan.destination.lat, plan.destination.lng],
      ];

  return (
    <div className="map-container">
      <MapContainer center={[plan.origin.lat, plan.origin.lng]} zoom={9} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={path} pathOptions={{ color: '#1a2b3c', weight: 4 }} />
        <Marker position={[plan.origin.lat, plan.origin.lng]} icon={originPin}>
          <Popup>Origin{plan.origin.label ? `: ${plan.origin.label}` : ''}</Popup>
        </Marker>
        {plan.stops.map((s, i) => (
          <Marker key={s.providerId} position={[s.location.lat, s.location.lng]} icon={pin('#1a2b3c', String(i + 1))}>
            <Popup>
              Stop {i + 1} &middot; {s.providerType} &middot; {s.pricePerkWh}/kWh
              <br />
              {s.approvalRequired ? 'Approval required' : 'No approval required'}
              <br />
              Leg: {s.legDistanceKm.toFixed(1)} km
            </Popup>
          </Marker>
        ))}
        <Marker position={[plan.destination.lat, plan.destination.lng]} icon={destinationPin}>
          <Popup>Destination{plan.destination.label ? `: ${plan.destination.label}` : ''}</Popup>
        </Marker>
        {overlay}
      </MapContainer>
    </div>
  );
}
