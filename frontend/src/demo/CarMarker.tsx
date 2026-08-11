import L from 'leaflet';
import { Marker } from 'react-leaflet';
import { DemoLatLng } from './types';

interface Props {
  position: DemoLatLng;
}

// Inline SVG, same approach TripPlanMap/LocationPickerMap already use --
// Vite doesn't reliably resolve Leaflet's default marker PNGs. Built lazily
// inside the component (not at module scope) so this module has no
// top-level side effect, which keeps it eliminable from a production
// bundle that never imports it (section 2.3).
let carIcon: L.DivIcon | undefined;
function getCarIcon(): L.DivIcon {
  if (!carIcon) {
    carIcon = L.divIcon({
      className: 'demo-car-icon',
      html: `
        <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
          <circle cx="14" cy="14" r="12" fill="#e08a1e" stroke="#ffffff" stroke-width="2"/>
          <text x="14" y="19" text-anchor="middle" font-size="14">🚗</text>
        </svg>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }
  return carIcon;
}

/** The animated car (DEMO_RUNNER_ADDENDUM.md section 3). Purely presentational -- useDemoRunner owns position/progress. */
export function CarMarker({ position }: Props) {
  return <Marker position={[position.lat, position.lng]} icon={getCarIcon()} zIndexOffset={1000} />;
}
