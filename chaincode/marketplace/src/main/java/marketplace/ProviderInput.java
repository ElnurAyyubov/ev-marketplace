/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import java.util.List;

/** The JSON payload accepted by {@code RegisterProvider}. */
public class ProviderInput {

    private String providerType;
    private long latitude;
    private long longitude;
    private String locationLabel;
    private long pricePerkWh;
    private long availableEnergy;
    private int numberOfSlots;
    private List<String> connectorTypes;
    private boolean approvalRequired;
    private String ipfsHash;

    public String getProviderType() {
        return providerType;
    }

    public void setProviderType(final String providerType) {
        this.providerType = providerType;
    }

    public long getLatitude() {
        return latitude;
    }

    public void setLatitude(final long latitude) {
        this.latitude = latitude;
    }

    public long getLongitude() {
        return longitude;
    }

    public void setLongitude(final long longitude) {
        this.longitude = longitude;
    }

    public String getLocationLabel() {
        return locationLabel;
    }

    public void setLocationLabel(final String locationLabel) {
        this.locationLabel = locationLabel;
    }

    public long getPricePerkWh() {
        return pricePerkWh;
    }

    public void setPricePerkWh(final long pricePerkWh) {
        this.pricePerkWh = pricePerkWh;
    }

    public long getAvailableEnergy() {
        return availableEnergy;
    }

    public void setAvailableEnergy(final long availableEnergy) {
        this.availableEnergy = availableEnergy;
    }

    public int getNumberOfSlots() {
        return numberOfSlots;
    }

    public void setNumberOfSlots(final int numberOfSlots) {
        this.numberOfSlots = numberOfSlots;
    }

    public List<String> getConnectorTypes() {
        return connectorTypes;
    }

    public void setConnectorTypes(final List<String> connectorTypes) {
        this.connectorTypes = connectorTypes;
    }

    public boolean isApprovalRequired() {
        return approvalRequired;
    }

    public void setApprovalRequired(final boolean approvalRequired) {
        this.approvalRequired = approvalRequired;
    }

    public String getIpfsHash() {
        return ipfsHash;
    }

    public void setIpfsHash(final String ipfsHash) {
        this.ipfsHash = ipfsHash;
    }
}
