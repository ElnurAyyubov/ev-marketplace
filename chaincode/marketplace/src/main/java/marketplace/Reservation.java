/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import org.hyperledger.fabric.contract.annotation.DataType;
import org.hyperledger.fabric.contract.annotation.Property;

/**
 * A driver's hold on a slot, including escrowed funds. Escrow is
 * represented implicitly via escrowAmount + state (no separate escrow
 * record for the MVP).
 */
@DataType()
public class Reservation {

    @Property() private String docType;
    @Property() private String reservationId;
    @Property() private String providerId;
    @Property() private String slotId;
    @Property() private String driverId;
    @Property() private long requestedEnergy;
    @Property() private long escrowAmount;
    @Property() private String state;
    @Property() private long createdAt;
    @Property() private long expiresAt;

    public String getDocType() {
        return docType;
    }

    public void setDocType(final String docType) {
        this.docType = docType;
    }

    public String getReservationId() {
        return reservationId;
    }

    public void setReservationId(final String reservationId) {
        this.reservationId = reservationId;
    }

    public String getProviderId() {
        return providerId;
    }

    public void setProviderId(final String providerId) {
        this.providerId = providerId;
    }

    public String getSlotId() {
        return slotId;
    }

    public void setSlotId(final String slotId) {
        this.slotId = slotId;
    }

    public String getDriverId() {
        return driverId;
    }

    public void setDriverId(final String driverId) {
        this.driverId = driverId;
    }

    public long getRequestedEnergy() {
        return requestedEnergy;
    }

    public void setRequestedEnergy(final long requestedEnergy) {
        this.requestedEnergy = requestedEnergy;
    }

    public long getEscrowAmount() {
        return escrowAmount;
    }

    public void setEscrowAmount(final long escrowAmount) {
        this.escrowAmount = escrowAmount;
    }

    public String getState() {
        return state;
    }

    public void setState(final String state) {
        this.state = state;
    }

    public long getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(final long createdAt) {
        this.createdAt = createdAt;
    }

    public long getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(final long expiresAt) {
        this.expiresAt = expiresAt;
    }
}
