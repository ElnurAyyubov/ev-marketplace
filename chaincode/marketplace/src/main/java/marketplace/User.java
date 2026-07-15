/*
 * SPDX-License-Identifier: Apache-2.0
 */
package marketplace;

import org.hyperledger.fabric.contract.annotation.DataType;
import org.hyperledger.fabric.contract.annotation.Property;

@DataType()
public class User {

    @Property()
    private String docType;

    @Property()
    private String userId;

    @Property()
    private String name;

    @Property()
    private boolean registered;

    public String getDocType() {
        return docType;
    }

    public void setDocType(final String docType) {
        this.docType = docType;
    }

    public String getUserId() {
        return userId;
    }

    public void setUserId(final String userId) {
        this.userId = userId;
    }

    public String getName() {
        return name;
    }

    public void setName(final String name) {
        this.name = name;
    }

    public boolean isRegistered() {
        return registered;
    }

    public void setRegistered(final boolean registered) {
        this.registered = registered;
    }
}
