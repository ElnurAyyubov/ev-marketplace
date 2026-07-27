import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { IDENTITIES_DIR, REPO_ROOT } from './fabric';

const execFileAsync = promisify(execFile);

// Fall back to the local fabric-samples checkout for standalone/dev-machine
// testing; in the container image fabric-ca-client is already on PATH
// (see gateway/docker, Dockerfile).
process.env.PATH = `${path.join(REPO_ROOT, 'fabric-samples', 'bin')}:${process.env.PATH ?? ''}`;

const CA_NAME = process.env.CA_NAME || 'ca-org1';
const CA_ENDPOINT = process.env.CA_ENDPOINT || 'localhost:7054';
const CA_TLS_CERT_PATH =
  process.env.CA_TLS_CERT_PATH ||
  path.join(REPO_ROOT, 'fabric-samples/test-network/organizations/fabric-ca/org1/ca-cert.pem');

// Scoped to hf.Registrar.Roles=client only (see CONTAINER_PROVISIONING_ADDENDUM.md
// "The identity split") -- delivered to this device's volume out-of-band,
// never baked into the image, consumed exactly once by enrollIdentity()
// below and then deleted.
const REGISTRAR_NAME = 'carregistrar';

export const PROVISIONED_MARKER = path.join(IDENTITIES_DIR, '.provisioned-user');

export class ProvisioningError extends Error {}

/**
 * Registers + enrolls `username` against the Fabric CA using the device's
 * one-time carregistrar credential, writes the marker entrypoint.sh checks
 * for, then deletes the registrar credential -- mirrors
 * scripts/run-user.sh's enroll_identity(), ported to child_process so it
 * can run inside a container with no shell script involved.
 */
export async function enrollIdentity(username: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    throw new ProvisioningError('username may only contain letters, numbers, - and _');
  }
  if (fs.existsSync(path.join(IDENTITIES_DIR, username, 'msp'))) {
    throw new ProvisioningError(`'${username}' is already enrolled`);
  }

  const registrarDir = path.join(IDENTITIES_DIR, REGISTRAR_NAME);
  const registrarMsp = path.join(registrarDir, 'msp');
  if (!fs.existsSync(registrarMsp)) {
    throw new ProvisioningError(
      'this device has not been provisioned with a car registrar credential'
    );
  }

  const secret = crypto.randomBytes(16).toString('hex');

  await execFileAsync('fabric-ca-client', [
    'register',
    '--caname', CA_NAME,
    '--id.name', username,
    '--id.secret', secret,
    '--id.type', 'client',
    '-u', `https://${CA_ENDPOINT}`,
    '--tls.certfiles', CA_TLS_CERT_PATH,
    '--mspdir', registrarMsp,
  ]);

  await execFileAsync('fabric-ca-client', [
    'enroll',
    '-u', `https://${username}:${secret}@${CA_ENDPOINT}`,
    '--caname', CA_NAME,
    '-M', path.join(IDENTITIES_DIR, username, 'msp'),
    '--tls.certfiles', CA_TLS_CERT_PATH,
  ]);

  // Written last, only once enrollment fully succeeded -- entrypoint.sh
  // treats this file's presence as "this device is provisioned."
  fs.writeFileSync(PROVISIONED_MARKER, username);

  // carregistrar has done its one job; it never lives on this device again.
  fs.rmSync(registrarDir, { recursive: true, force: true });
}
