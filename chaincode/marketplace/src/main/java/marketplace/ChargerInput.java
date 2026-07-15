/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

/**
 * The JSON payload accepted by {@code RegisterCharger}. {@code chargerId}
 * must name a pre-enrolled charger identity (its certificate CommonName) so
 * that later charger-only calls can verify the caller against this binding.
 */
public class ChargerInput {

    private String chargerId;
    private String providerId;
    private int slotIndex;
    private int ratedPowerKw;

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
}
