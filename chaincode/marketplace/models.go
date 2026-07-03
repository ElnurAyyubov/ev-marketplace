package main

// Doc type discriminators, stored on every world-state record so CouchDB
// selector queries can filter by type.
const (
	DocTypeUser        = "user"
	DocTypeProvider    = "provider"
	DocTypeSlot        = "slot"
	DocTypeReservation = "reservation"
	DocTypeSession     = "session"
)

// Provider types. Left open-ended (plain string) so future kinds
// (hotel, mall, workplace, ...) can be added without a contract change.
const (
	ProviderTypeCommercial  = "Commercial"
	ProviderTypeResidential = "Residential"
)

const (
	ProviderStatusActive   = "Active"
	ProviderStatusInactive = "Inactive"
)

// Reservation state machine states.
const (
	ReservationStateRequested = "REQUESTED"
	ReservationStateConfirmed = "CONFIRMED"
	ReservationStateActive    = "ACTIVE"
	ReservationStateCompleted = "COMPLETED"
	ReservationStateCancelled = "CANCELLED"
	ReservationStateExpired   = "EXPIRED"
)

// Session states.
const (
	SessionStateActive    = "Active"
	SessionStateCompleted = "Completed"
	SessionStateDisputed  = "Disputed"
)

// User is a registered marketplace participant.
type User struct {
	DocType    string `json:"docType"`
	UserID     string `json:"userId"`
	Name       string `json:"name"`
	Registered bool   `json:"registered"`
}

// ChargingProvider is a generalized charging service provider,
// distinguished by ProviderType (Commercial vs Residential).
type ChargingProvider struct {
	DocType               string   `json:"docType"`
	ProviderID            string   `json:"providerId"`
	OwnerID               string   `json:"ownerId"`
	ProviderType          string   `json:"providerType"`
	Latitude              int64    `json:"latitude"`  // scaled by 1e6
	Longitude             int64    `json:"longitude"`  // scaled by 1e6
	LocationLabel         string   `json:"locationLabel"`
	PricePerkWh           int64    `json:"pricePerkWh"` // smallest token unit
	AvailableEnergy       int64    `json:"availableEnergy"`
	NumberOfSlots         int      `json:"numberOfSlots"`
	CurrentAvailableSlots int      `json:"currentAvailableSlots"`
	ConnectorTypes        []string `json:"connectorTypes"`
	ApprovalRequired      bool     `json:"approvalRequired"`
	Status                string   `json:"status"`
	IpfsHash              string   `json:"ipfsHash"`
}

// Slot is one chargeable position at a provider.
type Slot struct {
	DocType               string `json:"docType"`
	SlotID                string `json:"slotId"`
	ProviderID             string `json:"providerId"`
	Occupied              bool   `json:"occupied"`
	CurrentReservationID  string `json:"currentReservationId"`
}

// Reservation tracks a driver's hold on a slot, including escrowed funds.
// Escrow is represented implicitly via EscrowAmount + State (no separate
// escrow record for the MVP).
type Reservation struct {
	DocType         string `json:"docType"`
	ReservationID   string `json:"reservationId"`
	ProviderID      string `json:"providerId"`
	SlotID          string `json:"slotId"`
	DriverID        string `json:"driverId"`
	RequestedEnergy int64  `json:"requestedEnergy"`
	EscrowAmount    int64  `json:"escrowAmount"`
	State           string `json:"state"`
	CreatedAt       int64  `json:"createdAt"`
	ExpiresAt       int64  `json:"expiresAt"`
}

// Session is a single charging session tied to a confirmed reservation.
type Session struct {
	DocType         string `json:"docType"`
	SessionID       string `json:"sessionId"`
	ReservationID   string `json:"reservationId"`
	StartTime       int64  `json:"startTime"`
	EndTime         int64  `json:"endTime"`
	DeliveredEnergy int64  `json:"deliveredEnergy"`
	SettledAmount   int64  `json:"settledAmount"`
	State           string `json:"state"`
}
