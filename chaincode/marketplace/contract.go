package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-chaincode-go/pkg/cid"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// SmartContract implements the EV charging marketplace chaincode.
type SmartContract struct {
	contractapi.Contract
}

// AdminIdentity is the enrollment ID treated as the faucet/admin caller.
// MVP simplification: identity is derived from certificate CommonName
// (see getCallerID), matching the gateway's pre-enrolled fixed identities
// (admin, alice, bob, provider1, ...).
const AdminIdentity = "admin"

// getCallerID derives the calling user's ID from their X.509 certificate's
// CommonName. This works because each pre-enrolled MVP identity
// (admin/alice/bob/provider1/...) is issued its own certificate with a
// distinct CN by the Fabric CA.
func getCallerID(ctx contractapi.TransactionContextInterface) (string, error) {
	cert, err := cid.GetX509Certificate(ctx.GetStub())
	if err != nil {
		return "", fmt.Errorf("failed to read caller certificate: %w", err)
	}
	if cert.Subject.CommonName == "" {
		return "", fmt.Errorf("caller certificate has no CommonName")
	}
	return cert.Subject.CommonName, nil
}

func userKey(ctx contractapi.TransactionContextInterface, userID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey("user", []string{userID})
}

func providerKey(ctx contractapi.TransactionContextInterface, providerID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey("provider", []string{providerID})
}

func slotKey(ctx contractapi.TransactionContextInterface, providerID, slotID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey("slot", []string{providerID, slotID})
}

func reservationKey(ctx contractapi.TransactionContextInterface, reservationID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey("reservation", []string{reservationID})
}

func sessionKey(ctx contractapi.TransactionContextInterface, sessionID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey("session", []string{sessionID})
}

func balanceKey(ctx contractapi.TransactionContextInterface, userID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey("balance", []string{userID})
}

// putJSON marshals v and writes it to the given key.
func putJSON(ctx contractapi.TransactionContextInterface, key string, v interface{}) error {
	bytes, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("failed to marshal state: %w", err)
	}
	return ctx.GetStub().PutState(key, bytes)
}

// getJSON reads the given key and unmarshals it into v. Returns an error
// if the key does not exist.
func getJSON(ctx contractapi.TransactionContextInterface, key string, v interface{}) error {
	bytes, err := ctx.GetStub().GetState(key)
	if err != nil {
		return fmt.Errorf("failed to read world state: %w", err)
	}
	if bytes == nil {
		return fmt.Errorf("no state found for key %s", key)
	}
	return json.Unmarshal(bytes, v)
}
