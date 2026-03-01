/**
 * Ambient declarations for the `blind-signatures` npm package.
 *
 * The package ships no bundled types.  Only the surface used by this project
 * is declared here.  All numeric values use decimal strings or jsbn BigIntegers
 * to stay compatible with the jsbn cross-module workaround (see issuer.ts).
 */

declare module 'blind-signatures' {
  import NodeRSA from 'node-rsa';
  import { BigInteger } from 'jsbn';

  interface BlindOptions {
    message: string;
    N: string;
    E: string;
  }

  interface BlindResult {
    /** The blinded message; send this to the issuer. */
    blinded: BigInteger;
    /** The blinding factor; keep this secret for use during unblinding. */
    r: BigInteger;
  }

  interface UnblindOptions {
    /** Blind signature string returned by the server. */
    signed: string;
    N: string;
    r: BigInteger;
  }

  interface VerifyOptions {
    /** Unblinded signature (result of BigInteger.toString()). */
    unblinded: string;
    N: string;
    E: string;
    message: string;
  }

  /** Generates a fresh RSA-b-bit keypair. */
  function keyGeneration(options: { b: number }): NodeRSA;

  /** Returns the hex-encoded SHA-256 hash of `message`. */
  function messageToHash(message: string): string;

  /** Blinds `message` using the server's public key (N, E). */
  function blind(options: BlindOptions): BlindResult;

  /** Removes the blinding factor from a blind signature. */
  function unblind(options: UnblindOptions): BigInteger;

  /** Returns true when `unblinded` is a valid RSA signature over `message`. */
  function verify(options: VerifyOptions): boolean;

  // The package uses module.exports = { ... } so TypeScript needs export =.
  const _exports: {
    keyGeneration: typeof keyGeneration;
    messageToHash: typeof messageToHash;
    blind:         typeof blind;
    unblind:       typeof unblind;
    verify:        typeof verify;
  };
  export = _exports;
}
