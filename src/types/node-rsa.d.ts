/**
 * Ambient declarations for the `node-rsa` npm package.
 *
 * Only the members accessed by this project are declared.
 *
 * NOTE: `keyPair.n`, `keyPair.e`, and `keyPair.d` are jsbn BigInteger instances
 * bundled *inside* node-rsa.  Do not pass them to code that uses a different
 * copy of jsbn (e.g. blind-signatures) — use `.toString()` to cross the
 * boundary.  See the cryptographic note in src/routes/issuer.ts.
 */

declare module 'node-rsa' {
  import { BigInteger } from 'jsbn';

  interface KeyPair {
    /** RSA modulus N. */
    n: BigInteger;
    /** Public exponent E (typically 65537). */
    e: BigInteger;
    /** Private exponent D. */
    d: BigInteger;
  }

  class NodeRSA {
    constructor(pem?: string);
    keyPair: KeyPair;
    exportKey(format: string): string;
  }

  export = NodeRSA;
}
