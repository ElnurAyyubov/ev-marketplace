import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Identity, Signer, signers } from '@hyperledger/fabric-gateway';

// MVP identity simplification (see MVP_BUILD_SPEC.md section 5): instead of
// per-user Fabric-CA enrollment, the gateway holds a small fixed set of
// pre-enrolled identities. The frontend selects which one to act as via the
// X-Identity header; the chaincode derives the caller's userId from that
// identity's certificate CommonName.
export const KNOWN_IDENTITIES = ['admin', 'alice', 'bob', 'provider1'] as const;
export type KnownIdentity = (typeof KNOWN_IDENTITIES)[number];

export function isKnownIdentity(name: string): name is KnownIdentity {
  return (KNOWN_IDENTITIES as readonly string[]).includes(name);
}

const CHANNEL_NAME = process.env.CHANNEL_NAME || 'mychannel';
const CHAINCODE_NAME = process.env.CHAINCODE_NAME || 'marketplace';
const MSP_ID = process.env.MSP_ID || 'Org1MSP';
const PEER_ENDPOINT = process.env.PEER_ENDPOINT || 'localhost:7051';
const PEER_HOST_ALIAS = process.env.PEER_HOST_ALIAS || 'peer0.org1.example.com';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const IDENTITIES_DIR = process.env.IDENTITIES_DIR || path.join(__dirname, '..', 'identities');
const PEER_TLS_CERT_PATH =
  process.env.PEER_TLS_CERT_PATH ||
  path.join(
    REPO_ROOT,
    'fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem'
  );

let grpcClient: grpc.Client | undefined;

function getGrpcClient(): grpc.Client {
  if (!grpcClient) {
    const tlsRootCert = fs.readFileSync(PEER_TLS_CERT_PATH);
    const credentials = grpc.credentials.createSsl(tlsRootCert);
    grpcClient = new grpc.Client(PEER_ENDPOINT, credentials, {
      'grpc.ssl_target_name_override': PEER_HOST_ALIAS,
    });
  }
  return grpcClient;
}

function loadIdentity(name: KnownIdentity): Identity {
  const certPath = path.join(IDENTITIES_DIR, name, 'msp', 'signcerts', 'cert.pem');
  const credentials = fs.readFileSync(certPath);
  return { mspId: MSP_ID, credentials };
}

function loadSigner(name: KnownIdentity): Signer {
  const keystoreDir = path.join(IDENTITIES_DIR, name, 'msp', 'keystore');
  const [keyFile] = fs.readdirSync(keystoreDir);
  if (!keyFile) {
    throw new Error(`no private key found for identity '${name}' in ${keystoreDir}`);
  }
  const privateKeyPem = fs.readFileSync(path.join(keystoreDir, keyFile));
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

/**
 * Opens a Fabric Gateway connection scoped to one identity, hands the
 * marketplace contract to `fn`, and always closes the connection
 * afterwards. The underlying gRPC client connection is long-lived and
 * shared across calls.
 */
export async function withContract<T>(
  identityName: KnownIdentity,
  fn: (contract: Contract) => Promise<T>
): Promise<T> {
  const gateway = connect({
    client: getGrpcClient(),
    identity: loadIdentity(identityName),
    signer: loadSigner(identityName),
  });
  try {
    const network = gateway.getNetwork(CHANNEL_NAME);
    const contract = network.getContract(CHAINCODE_NAME);
    return await fn(contract);
  } finally {
    gateway.close();
  }
}
