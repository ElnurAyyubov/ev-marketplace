import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Identity, Signer, signers } from '@hyperledger/fabric-gateway';

// Addendum A section 7: the simulator signs with the pre-enrolled charger
// identity's own certificate; it must not route StartSession/
// RecordMeterReading/StopSession through the gateway's public REST API
// with an X-Identity header. This module connects straight to a Fabric
// peer, scoped to a single charger identity, instead of reusing the
// gateway's per-request multi-identity connection helper. Charger
// identities are pre-enrolled alongside the gateway's demo identities (see
// gateway/identities/ and README "Identities" section) -- IDENTITIES_DIR
// defaults to that directory so no separate provisioning step is needed.

const CHANNEL_NAME = process.env.CHANNEL_NAME || 'mychannel';
const CHAINCODE_NAME = process.env.CHAINCODE_NAME || 'marketplace';
const MSP_ID = process.env.MSP_ID || 'Org1MSP';
const PEER_ENDPOINT = process.env.PEER_ENDPOINT || 'localhost:7051';
const PEER_HOST_ALIAS = process.env.PEER_HOST_ALIAS || 'peer0.org1.example.com';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const IDENTITIES_DIR = process.env.IDENTITIES_DIR || path.join(REPO_ROOT, 'gateway', 'identities');
const PEER_TLS_CERT_PATH =
  process.env.PEER_TLS_CERT_PATH ||
  path.join(
    REPO_ROOT,
    'fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem'
  );

function loadIdentity(name: string): Identity {
  const certPath = path.join(IDENTITIES_DIR, name, 'msp', 'signcerts', 'cert.pem');
  const credentials = fs.readFileSync(certPath);
  return { mspId: MSP_ID, credentials };
}

function loadSigner(name: string): Signer {
  const keystoreDir = path.join(IDENTITIES_DIR, name, 'msp', 'keystore');
  const [keyFile] = fs.readdirSync(keystoreDir);
  if (!keyFile) {
    throw new Error(`no private key found for identity '${name}' in ${keystoreDir}`);
  }
  const privateKeyPem = fs.readFileSync(path.join(keystoreDir, keyFile));
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

/** Opens one long-lived Fabric Gateway connection signing as chargerId, for the lifetime of the simulator process. */
export function connectAsCharger(chargerId: string): { contract: Contract; close: () => void } {
  const tlsRootCert = fs.readFileSync(PEER_TLS_CERT_PATH);
  const credentials = grpc.credentials.createSsl(tlsRootCert);
  const client = new grpc.Client(PEER_ENDPOINT, credentials, {
    'grpc.ssl_target_name_override': PEER_HOST_ALIAS,
  });

  const gateway = connect({
    client,
    identity: loadIdentity(chargerId),
    signer: loadSigner(chargerId),
  });

  const network = gateway.getNetwork(CHANNEL_NAME);
  const contract = network.getContract(CHAINCODE_NAME);

  return {
    contract,
    close: () => {
      gateway.close();
      client.close();
    },
  };
}
