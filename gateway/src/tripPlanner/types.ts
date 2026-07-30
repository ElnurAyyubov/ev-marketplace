export interface LatLng {
  lat: number;
  lng: number;
}

export interface Waypoint extends LatLng {
  label?: string; // original free-text place name, e.g. "Beşiktaş"; display only
}

export type ProviderType = 'Commercial' | 'Residential';

export interface PlanConstraints {
  providerType?: ProviderType;
  maxPricePerkWh?: number;
  approvalRequired?: boolean;
  connectorTypes?: string[];
}

export interface PlannedStop {
  providerId: string;
  location: LatLng;
  providerType: ProviderType;
  pricePerkWh: number;
  approvalRequired: boolean;
  legDistanceKm: number; // roadKm from the previous waypoint to this stop
}

export type TripPlanStatus = 'feasible' | 'no_feasible_route';

export interface TripPlan {
  origin: Waypoint;
  destination: Waypoint;
  constraints: PlanConstraints;
  maxLegKm: number;

  status: TripPlanStatus;
  reason?: string;
  stops: PlannedStop[];
  finalLegKm: number;

  totalDistanceKm: number;
  stopCount: number;

  roadGeometry?: LatLng[];
  roadDistanceKm?: number;
  etaMinutes?: number;
}

export interface PlanRequest {
  origin: Waypoint;
  destination: Waypoint;
  maxLegKm?: number;
  constraints?: PlanConstraints;
  useStrandingGuard?: boolean;
}

/** A provider candidate as read from the ledger, decision-relevant fields only. */
export interface ProviderCandidate {
  providerId: string;
  location: LatLng;
  providerType: ProviderType;
  pricePerkWh: number;
  approvalRequired: boolean;
  connectorTypes: string[];
}

/**
 * The planner's only side-effecting dependency: a bounding-box read over
 * qualifying providers. Production wires this to QueryProviders; tests seed
 * it with fixed in-memory data so the planner itself stays a pure function
 * of (request, queryFn).
 */
export type ProviderQueryFn = (
  box: { center: LatLng; radiusKm: number },
  constraints: PlanConstraints
) => Promise<ProviderCandidate[]>;
