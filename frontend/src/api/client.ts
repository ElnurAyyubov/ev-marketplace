import {
  Charger,
  ChargingProvider,
  Identity,
  PlanConstraints,
  Reading,
  Reservation,
  Session,
  Slot,
  TripPlan,
  User,
} from './types';

const BASE_URL = import.meta.env.VITE_GATEWAY_URL || '';

export const setupApi = {
  status: () => fetch(`${BASE_URL}/setup/status`).then(r => r.json()),
  register: (username: string) =>
    fetch(`${BASE_URL}/setup/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    }),
};

async function request<T>(
  identity: Identity,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Identity': identity,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(payload.error || `request failed with status ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  getUser: (identity: Identity, userId: string) =>
    request<User>(identity, 'GET', `/users/${userId}`),

  createProvider: (
    identity: Identity,
    payload: {
      providerType: string;
      lat: number;
      lng: number;
      locationLabel: string;
      pricePerkWh: number;
      availableEnergy: number;
      numberOfSlots: number;
      connectorTypes: string[];
      approvalRequired: boolean;
    }
  ) => request<{ providerId: string }>(identity, 'POST', '/providers', payload),

  queryProviders: (
    identity: Identity,
    filters: {
      type?: string;
      minPrice?: number;
      maxPrice?: number;
      approvalRequired?: boolean;
      lat?: number;
      lng?: number;
      radiusKm?: number;
      ownerId?: string;
    }
  ) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
    const query = params.toString();
    return request<ChargingProvider[]>(
      identity,
      'GET',
      `/providers${query ? `?${query}` : ''}`
    );
  },

  // Translates a free-text query into filter values (type/minPrice/maxPrice/
  // approvalRequired) matching the marketplace page's own filter inputs. It
  // does not return providers directly — the caller applies the returned
  // filters via queryProviders.
  parseNlFilters: (identity: Identity, query: string) =>
    request<{
      filters: {
        type?: 'Commercial' | 'Residential';
        minPrice?: number;
        maxPrice?: number;
        approvalRequired?: boolean;
      };
    }>(identity, 'POST', '/search/nl', { query }),

  getProvider: (identity: Identity, providerId: string) =>
    request<ChargingProvider>(identity, 'GET', `/providers/${providerId}`),

  updateProviderStatus: (identity: Identity, providerId: string, status: string) =>
    request<void>(identity, 'PATCH', `/providers/${providerId}/status`, { status }),

  deleteProvider: (identity: Identity, providerId: string) =>
    request<void>(identity, 'DELETE', `/providers/${providerId}`),

  getSlots: (identity: Identity, providerId: string) =>
    request<Slot[]>(identity, 'GET', `/providers/${providerId}/slots`),

  registerCharger: (
    identity: Identity,
    payload: { providerId: string; slotIndex: number; ratedPowerKw: number; chargerId: string }
  ) => request<{ chargerId: string }>(identity, 'POST', '/chargers', payload),

  getCharger: (identity: Identity, chargerId: string) =>
    request<Charger>(identity, 'GET', `/chargers/${chargerId}`),

  listChargersByProvider: (identity: Identity, providerId: string) =>
    request<Charger[]>(identity, 'GET', `/providers/${providerId}/chargers`),

  createReservation: (
    identity: Identity,
    payload: { providerId: string; slotId: string; requestedEnergy: number }
  ) => request<{ reservationId: string }>(identity, 'POST', '/reservations', payload),

  approveReservation: (identity: Identity, reservationId: string) =>
    request<void>(identity, 'POST', `/reservations/${reservationId}/approve`),

  cancelReservation: (identity: Identity, reservationId: string) =>
    request<void>(identity, 'POST', `/reservations/${reservationId}/cancel`),

  getReservation: (identity: Identity, reservationId: string) =>
    request<Reservation>(identity, 'GET', `/reservations/${reservationId}`),

  listReservationsByDriver: (identity: Identity, driverId: string) =>
    request<Reservation[]>(identity, 'GET', `/reservations?driverId=${driverId}`),

  listReservationsByProvider: (identity: Identity, providerId: string) =>
    request<Reservation[]>(identity, 'GET', `/reservations?providerId=${providerId}`),

  // Sessions are charger-initiated (Addendum A section 3.2/9) -- there is no
  // driver/gateway "start session" call. The charger-sim daemon starts
  // sessions directly against Fabric using its own charger identity.

  stopSession: (identity: Identity, sessionId: string) =>
    request<void>(identity, 'POST', `/sessions/${sessionId}/stop`),

  flagMalfunction: (identity: Identity, sessionId: string, note: string) =>
    request<void>(identity, 'POST', `/sessions/${sessionId}/malfunction`, { note }),

  getSession: (identity: Identity, sessionId: string) =>
    request<Session>(identity, 'GET', `/sessions/${sessionId}`),

  getSessionReadings: (identity: Identity, sessionId: string) =>
    request<Reading[]>(identity, 'GET', `/sessions/${sessionId}/readings`),

  listSessionsByReservation: (identity: Identity, reservationId: string) =>
    request<Session[]>(identity, 'GET', `/sessions?reservationId=${reservationId}`),

  getBalance: (identity: Identity, userId: string) =>
    request<{ balance: number }>(identity, 'GET', `/balance/${userId}`),

  faucet: (identity: Identity, userId: string, amount: number) =>
    request<void>(identity, 'POST', '/faucet', { userId, amount }),

  // Trip planner (read-only, advisory -- see TRIP_PLANNER_ADDENDUM.md).
  planTrip: (
    identity: Identity,
    payload: {
      origin: { lat: number; lng: number } | string;
      destination: { lat: number; lng: number } | string;
      maxLegKm?: number;
      constraints?: PlanConstraints;
    }
  ) => request<TripPlan>(identity, 'POST', '/trip/plan', payload),

  planTripNl: (identity: Identity, query: string) =>
    request<{ plan: TripPlan; narration?: string }>(identity, 'POST', '/trip/plan/nl', { query }),
};
