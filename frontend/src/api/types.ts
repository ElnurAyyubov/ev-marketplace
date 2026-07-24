export type Identity = string;

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

export type ChargerStatus = 'Active' | 'Inactive';

export interface Charger {
  docType: 'charger';
  chargerId: string;
  providerId: string;
  slotIndex: number;
  ratedPowerKw: number;
  status: ChargerStatus;
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
  escrowAmount: number; // pre-authorization hold, not a disputed-settlement escrow (Addendum A section 4)
  state: ReservationState;
  createdAt: number;
  expiresAt: number; // also functions as the charger-start "startDeadline" while CONFIRMED
}

// Addendum A section 5.2: the entire session machine is ACTIVE -> SETTLED.
export type SessionState = 'Active' | 'Settled';

export interface Session {
  docType: 'session';
  sessionId: string;
  reservationId: string;
  chargerId: string;
  startTime: number;
  endTime: number;
  cumulativeWh: number; // live/final cumulative meter reading, in Wh
  readingCount: number;
  lastReadingTimestamp: number;
  deliveredEnergy: number; // kWh, set at StopSession = floor(cumulativeWh / 1000)
  settledAmount: number;
  state: SessionState;
}

export interface Reading {
  docType: 'reading';
  sessionId: string;
  seq: number;
  cumulativeWh: number;
  timestamp: number;
}
