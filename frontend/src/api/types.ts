export type Identity = 'admin' | 'alice' | 'bob' | 'provider1';

export type ProviderType = 'Commercial' | 'Residential';
export type ProviderStatus = 'Active' | 'Inactive';

export interface User {
  docType: 'user';
  userId: string;
  name: string;
  registered: boolean;
}

export interface ChargingProvider {
  docType: 'provider';
  providerId: string;
  ownerId: string;
  providerType: ProviderType;
  latitude: number; // scaled by 1e6
  longitude: number; // scaled by 1e6
  locationLabel: string;
  pricePerkWh: number;
  availableEnergy: number;
  numberOfSlots: number;
  currentAvailableSlots: number;
  connectorTypes: string[];
  approvalRequired: boolean;
  status: ProviderStatus;
  ipfsHash: string;
}

export interface Slot {
  docType: 'slot';
  slotId: string;
  providerId: string;
  occupied: boolean;
  currentReservationId: string;
}

export type ReservationState =
  | 'REQUESTED'
  | 'CONFIRMED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface Reservation {
  docType: 'reservation';
  reservationId: string;
  providerId: string;
  slotId: string;
  driverId: string;
  requestedEnergy: number;
  escrowAmount: number;
  state: ReservationState;
  createdAt: number;
  expiresAt: number;
}

export type SessionState = 'Active' | 'Completed' | 'Disputed';

export interface Session {
  docType: 'session';
  sessionId: string;
  reservationId: string;
  startTime: number;
  endTime: number;
  deliveredEnergy: number;
  settledAmount: number;
  state: SessionState;
}
