package main

import (
	"fmt"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// getBalance reads a user's balance, defaulting to 0 if never set.
func getBalance(ctx contractapi.TransactionContextInterface, userID string) (int64, error) {
	key, err := balanceKey(ctx, userID)
	if err != nil {
		return 0, err
	}
	bytes, err := ctx.GetStub().GetState(key)
	if err != nil {
		return 0, fmt.Errorf("failed to read balance: %w", err)
	}
	if bytes == nil {
		return 0, nil
	}
	balance, err := strconv.ParseInt(string(bytes), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("corrupt balance value for %s: %w", userID, err)
	}
	return balance, nil
}

// setBalance writes a user's balance.
//
// MVP limitation (documented per spec section 7): this is a simple mutable
// balance updated in place. It is not safe under highly concurrent writes
// to the same user's balance, since Fabric's MVCC will cause one of two
// concurrent read-modify-write transactions on the same key to fail. A
// post-MVP hardening would replace this with an event-sourced model:
// immutable settlement entries keyed `{providerId}~{txId}`, with the
// balance computed by aggregation instead of stored directly.
func setBalance(ctx contractapi.TransactionContextInterface, userID string, balance int64) error {
	key, err := balanceKey(ctx, userID)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(key, []byte(strconv.FormatInt(balance, 10)))
}

// creditBalance adds amount (must be >= 0) to a user's balance.
func creditBalance(ctx contractapi.TransactionContextInterface, userID string, amount int64) error {
	if amount < 0 {
		return fmt.Errorf("credit amount must not be negative")
	}
	balance, err := getBalance(ctx, userID)
	if err != nil {
		return err
	}
	return setBalance(ctx, userID, balance+amount)
}

// debitBalance subtracts amount (must be >= 0) from a user's balance,
// failing if funds are insufficient.
func debitBalance(ctx contractapi.TransactionContextInterface, userID string, amount int64) error {
	if amount < 0 {
		return fmt.Errorf("debit amount must not be negative")
	}
	balance, err := getBalance(ctx, userID)
	if err != nil {
		return err
	}
	if balance < amount {
		return fmt.Errorf("insufficient balance: %s has %d, needs %d", userID, balance, amount)
	}
	return setBalance(ctx, userID, balance-amount)
}

// Mint credits amount to userId. Dev-only faucet, admin-only.
func (s *SmartContract) Mint(ctx contractapi.TransactionContextInterface, userID string, amount int) error {
	callerID, err := getCallerID(ctx)
	if err != nil {
		return err
	}
	if callerID != AdminIdentity {
		return fmt.Errorf("only %s may mint tokens", AdminIdentity)
	}
	if amount <= 0 {
		return fmt.Errorf("mint amount must be positive")
	}
	return creditBalance(ctx, userID, int64(amount))
}

// GetBalance returns a user's token balance.
func (s *SmartContract) GetBalance(ctx contractapi.TransactionContextInterface, userID string) (int, error) {
	balance, err := getBalance(ctx, userID)
	if err != nil {
		return 0, err
	}
	return int(balance), nil
}

// Transfer moves amount from the caller's balance to `to`. Optional in the
// MVP scope, included for completeness.
func (s *SmartContract) Transfer(ctx contractapi.TransactionContextInterface, to string, amount int) error {
	if amount <= 0 {
		return fmt.Errorf("transfer amount must be positive")
	}
	callerID, err := getCallerID(ctx)
	if err != nil {
		return err
	}
	if callerID == to {
		return fmt.Errorf("cannot transfer to self")
	}
	if err := debitBalance(ctx, callerID, int64(amount)); err != nil {
		return err
	}
	return creditBalance(ctx, to, int64(amount))
}
