package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// ReservationTimeoutSeconds is how long a REQUESTED reservation (awaiting
// residential-owner approval) stays valid before it can be expired.
const ReservationTimeoutSeconds = 15 * 60

func txNow(ctx contractapi.TransactionContextInterface) (int64, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return 0, fmt.Errorf("failed to read transaction timestamp: %w", err)
	}
	return ts.Seconds, nil
}

func getReservationByID(ctx contractapi.TransactionContextInterface, reservationID string) (*Reservation, string, error) {
	key, err := reservationKey(ctx, reservationID)
	if err != nil {
		return nil, "", err
	}
	var reservation Reservation
	if err := getJSON(ctx, key, &reservation); err != nil {
		return nil, "", fmt.Errorf("reservation %s not found: %w", reservationID, err)
	}
	return &reservation, key, nil
}

func getSlotByID(ctx contractapi.TransactionContextInterface, providerID, slotID string) (*Slot, string, error) {
	key, err := slotKey(ctx, providerID, slotID)
	if err != nil {
		return nil, "", err
	}
	var slot Slot
	if err := getJSON(ctx, key, &slot); err != nil {
		return nil, "", fmt.Errorf("slot %s for provider %s not found: %w", slotID, providerID, err)
	}
	return &slot, key, nil
}

// CreateReservation reserves a free slot for the calling driver. Escrow is
// locked immediately if the provider does not require owner approval;
// otherwise the reservation waits in REQUESTED state. Either way the slot
// is marked occupied as part of this call, so a losing concurrent
// CreateReservation on the same slot fails cleanly instead of double
// booking (Fabric's MVCC read-set on the slot key causes the loser's
// transaction to be invalidated at commit time).
func (s *SmartContract) CreateReservation(ctx contractapi.TransactionContextInterface, providerID string, slotID string, requestedEnergy int) (string, error) {
	if requestedEnergy <= 0 {
		return "", fmt.Errorf("requestedEnergy must be positive")
	}

	driverID, err := getCallerID(ctx)
	if err != nil {
		return "", err
	}

	provider, providerStateKey, err := func() (*ChargingProvider, string, error) {
		key, err := providerKey(ctx, providerID)
		if err != nil {
			return nil, "", err
		}
		var p ChargingProvider
		if err := getJSON(ctx, key, &p); err != nil {
			return nil, "", fmt.Errorf("provider %s not found: %w", providerID, err)
		}
		return &p, key, nil
	}()
	if err != nil {
		return "", err
	}
	if provider.Status != ProviderStatusActive {
		return "", fmt.Errorf("provider %s is not active", providerID)
	}

	slot, slotStateKey, err := getSlotByID(ctx, providerID, slotID)
	if err != nil {
		return "", err
	}
	if slot.Occupied {
		return "", fmt.Errorf("slot %s on provider %s is already occupied", slotID, providerID)
	}

	escrowAmount := int64(requestedEnergy) * provider.PricePerkWh

	now, err := txNow(ctx)
	if err != nil {
		return "", err
	}

	txID := ctx.GetStub().GetTxID()
	reservationID := "res-" + txID

	state := ReservationStateConfirmed
	if provider.ApprovalRequired {
		state = ReservationStateRequested
	} else {
		// No approval needed: lock escrow immediately.
		if err := debitBalance(ctx, driverID, escrowAmount); err != nil {
			return "", fmt.Errorf("cannot lock escrow: %w", err)
		}
	}

	reservation := Reservation{
		DocType:         DocTypeReservation,
		ReservationID:   reservationID,
		ProviderID:      providerID,
		SlotID:          slotID,
		DriverID:        driverID,
		RequestedEnergy: int64(requestedEnergy),
		EscrowAmount:    0,
		State:           state,
		CreatedAt:       now,
		ExpiresAt:       now + ReservationTimeoutSeconds,
	}
	if state == ReservationStateConfirmed {
		reservation.EscrowAmount = escrowAmount
	}

	resKey, err := reservationKey(ctx, reservationID)
	if err != nil {
		return "", err
	}
	if err := putJSON(ctx, resKey, reservation); err != nil {
		return "", err
	}

	// Mark the slot occupied regardless of approval state, to prevent
	// double-booking while a REQUESTED reservation awaits approval.
	slot.Occupied = true
	slot.CurrentReservationID = reservationID
	if err := putJSON(ctx, slotStateKey, *slot); err != nil {
		return "", err
	}

	// Touch the provider's available-slot counter.
	provider.CurrentAvailableSlots--
	if err := putJSON(ctx, providerStateKey, *provider); err != nil {
		return "", err
	}

	return reservationID, nil
}

// ApproveReservation lets a residential provider's owner approve a pending
// (REQUESTED) reservation, locking escrow and moving it to CONFIRMED.
func (s *SmartContract) ApproveReservation(ctx contractapi.TransactionContextInterface, reservationID string) error {
	callerID, err := getCallerID(ctx)
	if err != nil {
		return err
	}

	reservation, resStateKey, err := getReservationByID(ctx, reservationID)
	if err != nil {
		return err
	}

	provider, err := s.GetProvider(ctx, reservation.ProviderID)
	if err != nil {
		return err
	}
	if provider.OwnerID != callerID {
		return fmt.Errorf("only the provider owner may approve this reservation")
	}

	if reservation.State != ReservationStateRequested {
		return fmt.Errorf("reservation %s is not awaiting approval (state=%s)", reservationID, reservation.State)
	}

	now, err := txNow(ctx)
	if err != nil {
		return err
	}
	if now > reservation.ExpiresAt {
		reservation.State = ReservationStateExpired
		if err := putJSON(ctx, resStateKey, *reservation); err != nil {
			return err
		}
		if err := freeSlot(ctx, reservation.ProviderID, reservation.SlotID); err != nil {
			return err
		}
		return fmt.Errorf("reservation %s expired before approval", reservationID)
	}

	escrowAmount := reservation.RequestedEnergy * provider.PricePerkWh
	if err := debitBalance(ctx, reservation.DriverID, escrowAmount); err != nil {
		return fmt.Errorf("cannot lock escrow: %w", err)
	}

	reservation.State = ReservationStateConfirmed
	reservation.EscrowAmount = escrowAmount
	return putJSON(ctx, resStateKey, *reservation)
}

// CancelReservation cancels a REQUESTED or CONFIRMED reservation, refunding
// any locked escrow and freeing the slot.
func (s *SmartContract) CancelReservation(ctx contractapi.TransactionContextInterface, reservationID string) error {
	callerID, err := getCallerID(ctx)
	if err != nil {
		return err
	}

	reservation, resStateKey, err := getReservationByID(ctx, reservationID)
	if err != nil {
		return err
	}

	provider, err := s.GetProvider(ctx, reservation.ProviderID)
	if err != nil {
		return err
	}
	if reservation.DriverID != callerID && provider.OwnerID != callerID {
		return fmt.Errorf("only the driver or provider owner may cancel this reservation")
	}

	if reservation.State != ReservationStateRequested && reservation.State != ReservationStateConfirmed {
		return fmt.Errorf("reservation %s cannot be cancelled from state %s", reservationID, reservation.State)
	}

	if reservation.EscrowAmount > 0 {
		if err := creditBalance(ctx, reservation.DriverID, reservation.EscrowAmount); err != nil {
			return err
		}
		reservation.EscrowAmount = 0
	}

	reservation.State = ReservationStateCancelled
	if err := putJSON(ctx, resStateKey, *reservation); err != nil {
		return err
	}
	return freeSlot(ctx, reservation.ProviderID, reservation.SlotID)
}

// ExpireReservation transitions a REQUESTED reservation past its
// expiresAt into EXPIRED, refunding nothing (no escrow was locked yet) and
// freeing the slot. Anyone may call this; it is a no-op error if the
// reservation isn't actually expired.
func (s *SmartContract) ExpireReservation(ctx contractapi.TransactionContextInterface, reservationID string) error {
	reservation, resStateKey, err := getReservationByID(ctx, reservationID)
	if err != nil {
		return err
	}
	if reservation.State != ReservationStateRequested {
		return fmt.Errorf("reservation %s is not in REQUESTED state", reservationID)
	}
	now, err := txNow(ctx)
	if err != nil {
		return err
	}
	if now <= reservation.ExpiresAt {
		return fmt.Errorf("reservation %s has not yet expired", reservationID)
	}

	reservation.State = ReservationStateExpired
	if err := putJSON(ctx, resStateKey, *reservation); err != nil {
		return err
	}
	return freeSlot(ctx, reservation.ProviderID, reservation.SlotID)
}

// GetReservation returns a reservation's record.
func (s *SmartContract) GetReservation(ctx contractapi.TransactionContextInterface, reservationID string) (*Reservation, error) {
	reservation, _, err := getReservationByID(ctx, reservationID)
	return reservation, err
}

// QueryReservationsByDriver lists all reservations made by a given driver,
// most useful for the driver's own reservation/session status view.
func (s *SmartContract) QueryReservationsByDriver(ctx contractapi.TransactionContextInterface, driverID string) ([]*Reservation, error) {
	return queryReservations(ctx, map[string]interface{}{"driverId": driverID})
}

// QueryReservationsByProvider lists all reservations against a given
// provider, most useful for a provider owner's pending-approvals view.
func (s *SmartContract) QueryReservationsByProvider(ctx contractapi.TransactionContextInterface, providerID string) ([]*Reservation, error) {
	return queryReservations(ctx, map[string]interface{}{"providerId": providerID})
}

func queryReservations(ctx contractapi.TransactionContextInterface, selector map[string]interface{}) ([]*Reservation, error) {
	selector["docType"] = DocTypeReservation
	query, err := json.Marshal(map[string]interface{}{"selector": selector})
	if err != nil {
		return nil, err
	}

	iterator, err := ctx.GetStub().GetQueryResult(string(query))
	if err != nil {
		return nil, fmt.Errorf("failed to execute rich query: %w", err)
	}
	defer iterator.Close()

	reservations := []*Reservation{}
	for iterator.HasNext() {
		result, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		var reservation Reservation
		if err := json.Unmarshal(result.Value, &reservation); err != nil {
			return nil, err
		}
		reservations = append(reservations, &reservation)
	}
	return reservations, nil
}

// freeSlot marks a slot unoccupied and bumps the provider's available-slot
// counter back up.
func freeSlot(ctx contractapi.TransactionContextInterface, providerID, slotID string) error {
	slot, slotStateKey, err := getSlotByID(ctx, providerID, slotID)
	if err != nil {
		return err
	}
	slot.Occupied = false
	slot.CurrentReservationID = ""
	if err := putJSON(ctx, slotStateKey, *slot); err != nil {
		return err
	}

	pKey, err := providerKey(ctx, providerID)
	if err != nil {
		return err
	}
	var provider ChargingProvider
	if err := getJSON(ctx, pKey, &provider); err != nil {
		return err
	}
	provider.CurrentAvailableSlots++
	return putJSON(ctx, pKey, provider)
}
