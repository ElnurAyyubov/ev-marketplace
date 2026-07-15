import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';

// The default Leaflet marker PNGs don't resolve reliably through Vite's
// bundler, so use a self-contained inline SVG pin instead of asset URLs.
const pinIcon = L.divIcon({
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
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}

function ClickHandler({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function LocationPickerMap({ lat, lng, onChange }: Props) {
  return (
    <div className="map-container">
      <MapContainer center={[lat, lng]} zoom={12} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lng]} icon={pinIcon} />
        <ClickHandler onChange={onChange} />
      </MapContainer>
    </div>
  );
}
