/**
 * Ambient declarations for the `jsbn` npm package.
 *
 * Only the BigInteger members used by this project are declared.
 *
 * IMPORTANT: blind-signatures and node-rsa each bundle their *own* copy of
 * jsbn.  The BigInteger class imported here is the top-level package copy.
 * Instances from different copies are not cross-compatible (their prototype
 * chains differ), which breaks modPow().  Always reconstruct BigIntegers from
 * decimal strings at module boundaries.
 */

declare module 'jsbn' {
  export class BigInteger {
    constructor(value: string, radix?: number);

    /**
     * Modular exponentiation: this^e mod m.
     * Used for RSA blind signing and verification.
     */
    modPow(e: BigInteger, m: BigInteger): BigInteger;

    /** Returns the decimal (or base-`radix`) string representation. */
    toString(radix?: number): string;
  }
}
