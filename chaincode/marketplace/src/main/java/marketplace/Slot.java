/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import org.hyperledger.fabric.contract.annotation.DataType;
import org.hyperledger.fabric.contract.annotation.Property;

/** One chargeable position at a provider. */
@DataType()
public class Slot {

    @Property() private String docType;
    @Property() private String slotId;
    @Property() private String providerId;
    @Property() private boolean occupied;
    @Property() private String currentReservationId;

    public String getDocType() {
        return docType;
    }

    public void setDocType(final String docType) {
        this.docType = docType;
    }

    public String getSlotId() {
        return slotId;
    }

    public void setSlotId(final String slotId) {
        this.slotId = slotId;
    }

    public String getProviderId() {
        return providerId;
    }

    public void setProviderId(final String providerId) {
        this.providerId = providerId;
    }

    public boolean isOccupied() {
        return occupied;
    }

    public void setOccupied(final boolean occupied) {
        this.occupied = occupied;
    }

    public String getCurrentReservationId() {
        return currentReservationId;
    }

    public void setCurrentReservationId(final String currentReservationId) {
        this.currentReservationId = currentReservationId;
    }
}
