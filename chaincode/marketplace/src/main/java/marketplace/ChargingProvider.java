/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import java.util.List;

import org.hyperledger.fabric.contract.annotation.DataType;
import org.hyperledger.fabric.contract.annotation.Property;

/**
 * A generalized charging service provider, distinguished by providerType
 * (Commercial vs Residential).
 */
@DataType()
public class ChargingProvider {

    @Property() private String docType;
    @Property() private String providerId;
    @Property() private String ownerId;
    @Property() private String providerType;
    @Property() private long latitude;  // scaled by 1e6
    @Property() private long longitude; // scaled by 1e6
    @Property() private String locationLabel;
    @Property() private long pricePerkWh; // smallest token unit
    @Property() private long availableEnergy;
    @Property() private int numberOfSlots;
    @Property() private int currentAvailableSlots;
    @Property() private List<String> connectorTypes;
    @Property() private boolean approvalRequired;
    @Property() private String status;
    @Property() private String ipfsHash;

    public String getDocType() {
        return docType;
    }

    public void setDocType(final String docType) {
        this.docType = docType;
    }

    public String getProviderId() {
        return providerId;
    }

    public void setProviderId(final String providerId) {
        this.providerId = providerId;
    }

    public String getOwnerId() {
        return ownerId;
    }

    public void setOwnerId(final String ownerId) {
        this.ownerId = ownerId;
    }

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

    public int getCurrentAvailableSlots() {
        return currentAvailableSlots;
    }

    public void setCurrentAvailableSlots(final int currentAvailableSlots) {
        this.currentAvailableSlots = currentAvailableSlots;
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

    public String getStatus() {
        return status;
    }

    public void setStatus(final String status) {
        this.status = status;
    }

    public String getIpfsHash() {
        return ipfsHash;
    }

    public void setIpfsHash(final String ipfsHash) {
        this.ipfsHash = ipfsHash;
    }
}
