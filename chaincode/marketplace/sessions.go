package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

func getSessionByID(ctx contractapi.TransactionContextInterface, sessionID string) (*Session, string, error) {
	key, err := sessionKey(ctx, sessionID)
	if err != nil {
		return nil, "", err
	}
	var session Session
	if err := getJSON(ctx, key, &session); err != nil {
		return nil, "", fmt.Errorf("session %s not found: %w", sessionID, err)
	}
	return &session, key, nil
}

// StartSession begins charging against a CONFIRMED reservation, moving the
// reservation to ACTIVE and creating its Session record.
func (s *SmartContract) StartSession(ctx contractapi.TransactionContextInterface, reservationID string) (string, error) {
	callerID, err := getCallerID(ctx)
	if err != nil {
		return "", err
	}

	reservation, resStateKey, err := getReservationByID(ctx, reservationID)
	if err != nil {
		return "", err
	}
	if reservation.State != ReservationStateConfirmed {
		return "", fmt.Errorf("reservation %s is not CONFIRMED (state=%s)", reservationID, reservation.State)
	}

	provider, err := s.GetProvider(ctx, reservation.ProviderID)
	if err != nil {
		return "", err
	}
	if callerID != reservation.DriverID && callerID != provider.OwnerID {
		return "", fmt.Errorf("only the driver or provider owner may start this session")
	}

	now, err := txNow(ctx)
	if err != nil {
		return "", err
	}

	sessionID := "sess-" + ctx.GetStub().GetTxID()
	session := Session{
		DocType:       DocTypeSession,
		SessionID:     sessionID,
		ReservationID: reservationID,
		StartTime:     now,
		EndTime:       0,
		State:         SessionStateActive,
	}
	sKey, err := sessionKey(ctx, sessionID)
	if err != nil {
		return "", err
	}
	if err := putJSON(ctx, sKey, session); err != nil {
		return "", err
	}

	reservation.State = ReservationStateActive
	if err := putJSON(ctx, resStateKey, *reservation); err != nil {
		return "", err
	}

	return sessionID, nil
}

// CompleteSession is called by the provider to report delivered energy. It
// settles escrow: the provider is paid deliveredEnergy * pricePerkWh
// (capped at the reservation's escrowAmount), and any remainder is
// refunded to the driver. Frees the slot.
func (s *SmartContract) CompleteSession(ctx contractapi.TransactionContextInterface, sessionID string, deliveredEnergy int) error {
	if deliveredEnergy < 0 {
		return fmt.Errorf("deliveredEnergy must not be negative")
	}

	callerID, err := getCallerID(ctx)
	if err != nil {
		return err
	}

	session, sessStateKey, err := getSessionByID(ctx, sessionID)
	if err != nil {
		return err
	}
	if session.State != SessionStateActive {
		return fmt.Errorf("session %s is not Active (state=%s)", sessionID, session.State)
	}

	reservation, resStateKey, err := getReservationByID(ctx, session.ReservationID)
	if err != nil {
		return err
	}

	provider, err := s.GetProvider(ctx, reservation.ProviderID)
	if err != nil {
		return err
	}
	if callerID != provider.OwnerID {
		return fmt.Errorf("only the provider owner may complete this session")
	}

	settled := int64(deliveredEnergy) * provider.PricePerkWh
	if settled > reservation.EscrowAmount {
		settled = reservation.EscrowAmount
	}
	refund := reservation.EscrowAmount - settled

	if settled > 0 {
		if err := creditBalance(ctx, provider.OwnerID, settled); err != nil {
			return err
		}
	}
	if refund > 0 {
		if err := creditBalance(ctx, reservation.DriverID, refund); err != nil {
			return err
		}
	}
	reservation.EscrowAmount = 0

	now, err := txNow(ctx)
	if err != nil {
		return err
	}

	session.DeliveredEnergy = int64(deliveredEnergy)
	session.SettledAmount = settled
	session.EndTime = now
	session.State = SessionStateCompleted
	if err := putJSON(ctx, sessStateKey, *session); err != nil {
		return err
	}

	reservation.State = ReservationStateCompleted
	if err := putJSON(ctx, resStateKey, *reservation); err != nil {
		return err
	}

	return freeSlot(ctx, reservation.ProviderID, reservation.SlotID)
}

// GetSession returns a session's record.
func (s *SmartContract) GetSession(ctx contractapi.TransactionContextInterface, sessionID string) (*Session, error) {
	session, _, err := getSessionByID(ctx, sessionID)
	return session, err
}

// QuerySessionsByReservation returns the (at most one) session for a
// given reservation.
func (s *SmartContract) QuerySessionsByReservation(ctx contractapi.TransactionContextInterface, reservationID string) ([]*Session, error) {
	selector := map[string]interface{}{"docType": DocTypeSession, "reservationId": reservationID}
	query, err := json.Marshal(map[string]interface{}{"selector": selector})
	if err != nil {
		return nil, err
	}

	iterator, err := ctx.GetStub().GetQueryResult(string(query))
	if err != nil {
		return nil, fmt.Errorf("failed to execute rich query: %w", err)
	}
	defer iterator.Close()

	sessions := []*Session{}
	for iterator.HasNext() {
		result, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		var session Session
		if err := json.Unmarshal(result.Value, &session); err != nil {
			return nil, err
		}
		sessions = append(sessions, &session)
	}
	return sessions, nil
}

// DisputeSession lets the driver flag a session (active or already
// completed) for manual review. MVP scope: this only records the flag: it
// freezes any not-yet-settled escrow (an Active session's funds stay
// locked, unresolved) and does not implement resolution logic.
func (s *SmartContract) DisputeSession(ctx contractapi.TransactionContextInterface, sessionID string) error {
	callerID, err := getCallerID(ctx)
	if err != nil {
		return err
	}

	session, sessStateKey, err := getSessionByID(ctx, sessionID)
	if err != nil {
		return err
	}
	if session.State != SessionStateActive && session.State != SessionStateCompleted {
		return fmt.Errorf("session %s cannot be disputed from state %s", sessionID, session.State)
	}

	reservation, _, err := getReservationByID(ctx, session.ReservationID)
	if err != nil {
		return err
	}
	if callerID != reservation.DriverID {
		return fmt.Errorf("only the driver may dispute this session")
	}

	session.State = SessionStateDisputed
	return putJSON(ctx, sessStateKey, *session)
}
