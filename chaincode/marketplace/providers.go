package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// ---------- Users ----------

// RegisterUser registers the calling identity as a marketplace user.
func (s *SmartContract) RegisterUser(ctx contractapi.TransactionContextInterface, name string) (*User, error) {
	userID, err := getCallerID(ctx)
	if err != nil {
		return nil, err
	}

	key, err := userKey(ctx, userID)
	if err != nil {
		return nil, err
	}

	existing, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, fmt.Errorf("failed to read world state: %w", err)
	}
	if existing != nil {
		return nil, fmt.Errorf("user %s is already registered", userID)
	}

	user := User{
		DocType:    DocTypeUser,
		UserID:     userID,
		Name:       name,
		Registered: true,
	}
	if err := putJSON(ctx, key, user); err != nil {
		return nil, err
	}
	return &user, nil
}

// GetUser returns a registered user's record.
func (s *SmartContract) GetUser(ctx contractapi.TransactionContextInterface, userID string) (*User, error) {
	key, err := userKey(ctx, userID)
	if err != nil {
		return nil, err
	}
	var user User
	if err := getJSON(ctx, key, &user); err != nil {
		return nil, fmt.Errorf("user %s not found: %w", userID, err)
	}
	return &user, nil
}

// ---------- Providers ----------

// registerProviderInput is the JSON payload accepted by RegisterProvider.
type registerProviderInput struct {
	ProviderType     string   `json:"providerType"`
	Latitude         int64    `json:"latitude"`
	Longitude        int64    `json:"longitude"`
	LocationLabel    string   `json:"locationLabel"`
	PricePerkWh      int64    `json:"pricePerkWh"`
	AvailableEnergy  int64    `json:"availableEnergy"`
	NumberOfSlots    int      `json:"numberOfSlots"`
	ConnectorTypes   []string `json:"connectorTypes"`
	ApprovalRequired bool     `json:"approvalRequired"`
	IpfsHash         string   `json:"ipfsHash"`
}

// RegisterProvider creates a new ChargingProvider (Commercial or
// Residential) along with its N slot records.
func (s *SmartContract) RegisterProvider(ctx contractapi.TransactionContextInterface, providerJSON string) (string, error) {
	ownerID, err := getCallerID(ctx)
	if err != nil {
		return "", err
	}

	var input registerProviderInput
	if err := json.Unmarshal([]byte(providerJSON), &input); err != nil {
		return "", fmt.Errorf("invalid provider JSON: %w", err)
	}

	if input.ProviderType != ProviderTypeCommercial && input.ProviderType != ProviderTypeResidential {
		return "", fmt.Errorf("invalid providerType %q: must be Commercial or Residential", input.ProviderType)
	}
	if input.NumberOfSlots <= 0 {
		return "", fmt.Errorf("numberOfSlots must be positive")
	}
	if input.PricePerkWh < 0 {
		return "", fmt.Errorf("pricePerkWh must not be negative")
	}

	txID := ctx.GetStub().GetTxID()
	providerID := "provider-" + txID

	provider := ChargingProvider{
		DocType:               DocTypeProvider,
		ProviderID:            providerID,
		OwnerID:                ownerID,
		ProviderType:          input.ProviderType,
		Latitude:              input.Latitude,
		Longitude:             input.Longitude,
		LocationLabel:         input.LocationLabel,
		PricePerkWh:           input.PricePerkWh,
		AvailableEnergy:       input.AvailableEnergy,
		NumberOfSlots:         input.NumberOfSlots,
		CurrentAvailableSlots: input.NumberOfSlots,
		ConnectorTypes:        input.ConnectorTypes,
		ApprovalRequired:      input.ApprovalRequired,
		Status:                ProviderStatusActive,
		IpfsHash:              input.IpfsHash,
	}

	key, err := providerKey(ctx, providerID)
	if err != nil {
		return "", err
	}
	if err := putJSON(ctx, key, provider); err != nil {
		return "", err
	}

	for i := 0; i < input.NumberOfSlots; i++ {
		slotID := fmt.Sprintf("%d", i)
		slot := Slot{
			DocType:              DocTypeSlot,
			SlotID:               slotID,
			ProviderID:           providerID,
			Occupied:             false,
			CurrentReservationID: "",
		}
		sKey, err := slotKey(ctx, providerID, slotID)
		if err != nil {
			return "", err
		}
		if err := putJSON(ctx, sKey, slot); err != nil {
			return "", err
		}
	}

	return providerID, nil
}

// GetProvider returns a provider's record.
func (s *SmartContract) GetProvider(ctx contractapi.TransactionContextInterface, providerID string) (*ChargingProvider, error) {
	key, err := providerKey(ctx, providerID)
	if err != nil {
		return nil, err
	}
	var provider ChargingProvider
	if err := getJSON(ctx, key, &provider); err != nil {
		return nil, fmt.Errorf("provider %s not found: %w", providerID, err)
	}
	return &provider, nil
}

// UpdateProviderStatus lets the owner activate/deactivate their provider.
func (s *SmartContract) UpdateProviderStatus(ctx contractapi.TransactionContextInterface, providerID string, status string) error {
	if status != ProviderStatusActive && status != ProviderStatusInactive {
		return fmt.Errorf("invalid status %q: must be Active or Inactive", status)
	}

	callerID, err := getCallerID(ctx)
	if err != nil {
		return err
	}

	key, err := providerKey(ctx, providerID)
	if err != nil {
		return err
	}
	var provider ChargingProvider
	if err := getJSON(ctx, key, &provider); err != nil {
		return fmt.Errorf("provider %s not found: %w", providerID, err)
	}

	if provider.OwnerID != callerID {
		return fmt.Errorf("only the provider owner may update its status")
	}

	provider.Status = status
	return putJSON(ctx, key, provider)
}

// GetSlots returns all slots for a provider.
func (s *SmartContract) GetSlots(ctx contractapi.TransactionContextInterface, providerID string) ([]*Slot, error) {
	iterator, err := ctx.GetStub().GetStateByPartialCompositeKey("slot", []string{providerID})
	if err != nil {
		return nil, fmt.Errorf("failed to query slots: %w", err)
	}
	defer iterator.Close()

	slots := []*Slot{}
	for iterator.HasNext() {
		result, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		var slot Slot
		if err := json.Unmarshal(result.Value, &slot); err != nil {
			return nil, err
		}
		slots = append(slots, &slot)
	}
	return slots, nil
}

// QueryProviders runs a CouchDB rich (Mango) query over provider records.
// selectorJSON is either a full query object (`{"selector": {...}}`) or a
// bare selector object (`{...}`) — callers (typically the gateway) build
// this from type / price-range / bounding-box filters. A docType filter is
// always enforced server-side so only provider documents are returned.
func (s *SmartContract) QueryProviders(ctx contractapi.TransactionContextInterface, selectorJSON string) ([]*ChargingProvider, error) {
	var raw map[string]interface{}
	if selectorJSON == "" {
		raw = map[string]interface{}{}
	} else if err := json.Unmarshal([]byte(selectorJSON), &raw); err != nil {
		return nil, fmt.Errorf("invalid selector JSON: %w", err)
	}

	selector, ok := raw["selector"].(map[string]interface{})
	if !ok {
		// Treat the whole payload as the selector body.
		selector = raw
	}
	selector["docType"] = DocTypeProvider

	query, err := json.Marshal(map[string]interface{}{"selector": selector})
	if err != nil {
		return nil, err
	}

	iterator, err := ctx.GetStub().GetQueryResult(string(query))
	if err != nil {
		return nil, fmt.Errorf("failed to execute rich query: %w", err)
	}
	defer iterator.Close()

	providers := []*ChargingProvider{}
	for iterator.HasNext() {
		result, err := iterator.Next()
		if err != nil {
			return nil, err
		}
		var provider ChargingProvider
		if err := json.Unmarshal(result.Value, &provider); err != nil {
			return nil, err
		}
		providers = append(providers, &provider)
	}
	return providers, nil
}
