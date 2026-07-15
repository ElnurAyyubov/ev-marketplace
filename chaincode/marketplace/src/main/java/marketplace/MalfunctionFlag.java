/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import org.hyperledger.fabric.contract.annotation.DataType;
import org.hyperledger.fabric.contract.annotation.Property;

/**
 * Vestigial malfunction acknowledgement (Addendum A, section 3.5). Under the
 * trusted-hardware assumption there is nothing on-ledger to adjudicate; this
 * record exists only so a malfunction claim is captured for off-chain
 * operational follow-up, not silently impossible. It never reopens or
 * reverses settlement.
 */
@DataType()
public class MalfunctionFlag {

    @Property() private String docType;
    @Property() private String sessionId;
    @Property() private String note;
    @Property() private String flaggedBy;
    @Property() private long flaggedAt;

    public String getDocType() {
        return docType;
    }

    public void setDocType(final String docType) {
        this.docType = docType;
    }

    public String getSessionId() {
        return sessionId;
    }

    public void setSessionId(final String sessionId) {
        this.sessionId = sessionId;
    }

    public String getNote() {
        return note;
    }

    public void setNote(final String note) {
        this.note = note;
    }

    public String getFlaggedBy() {
        return flaggedBy;
    }

    public void setFlaggedBy(final String flaggedBy) {
        this.flaggedBy = flaggedBy;
    }

    public long getFlaggedAt() {
        return flaggedAt;
    }

    public void setFlaggedAt(final long flaggedAt) {
        this.flaggedAt = flaggedAt;
    }
}
