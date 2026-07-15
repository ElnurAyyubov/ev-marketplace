/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import org.hyperledger.fabric.contract.annotation.DataType;
import org.hyperledger.fabric.contract.annotation.Property;

/**
 * A smart-charger device, a first-class participant with its own ledger
 * identity distinct from the provider that owns it (Addendum A, section 2).
 */
@DataType()
public class Charger {

    @Property() private String docType;
    @Property() private String chargerId;
    @Property() private String providerId;
    @Property() private int slotIndex;
    @Property() private int ratedPowerKw;
    @Property() private String status;

    public String getDocType() {
        return docType;
    }

    public void setDocType(final String docType) {
        this.docType = docType;
    }

    public String getChargerId() {
        return chargerId;
    }

    public void setChargerId(final String chargerId) {
        this.chargerId = chargerId;
    }

    public String getProviderId() {
        return providerId;
    }

    public void setProviderId(final String providerId) {
        this.providerId = providerId;
    }

    public int getSlotIndex() {
        return slotIndex;
    }

    public void setSlotIndex(final int slotIndex) {
        this.slotIndex = slotIndex;
    }

    public int getRatedPowerKw() {
        return ratedPowerKw;
    }

    public void setRatedPowerKw(final int ratedPowerKw) {
        this.ratedPowerKw = ratedPowerKw;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(final String status) {
        this.status = status;
    }
}
