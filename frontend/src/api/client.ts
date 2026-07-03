import {
  ChargingProvider,
  Identity,
  Reservation,
  Session,
  Slot,
  User,
} from './types';

const BASE_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:3000';

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
  registerUser: (identity: Identity, name: string) =>
    request<User>(identity, 'POST', '/users/register', { name }),
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

  getProvider: (identity: Identity, providerId: string) =>
    request<ChargingProvider>(identity, 'GET', `/providers/${providerId}`),

  updateProviderStatus: (identity: Identity, providerId: string, status: string) =>
    request<void>(identity, 'PATCH', `/providers/${providerId}/status`, { status }),

  getSlots: (identity: Identity, providerId: string) =>
    request<Slot[]>(identity, 'GET', `/providers/${providerId}/slots`),

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

  startSession: (identity: Identity, reservationId: string) =>
    request<{ sessionId: string }>(identity, 'POST', '/sessions', { reservationId }),

  completeSession: (identity: Identity, sessionId: string, deliveredEnergy: number) =>
    request<void>(identity, 'POST', `/sessions/${sessionId}/complete`, { deliveredEnergy }),

  disputeSession: (identity: Identity, sessionId: string) =>
    request<void>(identity, 'POST', `/sessions/${sessionId}/dispute`),

  getSession: (identity: Identity, sessionId: string) =>
    request<Session>(identity, 'GET', `/sessions/${sessionId}`),

  listSessionsByReservation: (identity: Identity, reservationId: string) =>
    request<Session[]>(identity, 'GET', `/sessions?reservationId=${reservationId}`),

  getBalance: (identity: Identity, userId: string) =>
    request<{ balance: number }>(identity, 'GET', `/balance/${userId}`),

  faucet: (identity: Identity, userId: string, amount: number) =>
    request<void>(identity, 'POST', '/faucet', { userId, amount }),
};
