declare module 'blind-signatures' {
  import { BigInteger } from 'jsbn';

  interface KeyGenerationOptions {
    b: number;
  }

  interface BlindOptions {
    message: string;
    N: string;
    E: string;
  }

  interface BlindResult {
    blinded: BigInteger;
    r: BigInteger;
  }

  interface UnblindOptions {
    signed: string;
    N: string;
    r: BigInteger;
  }

  interface VerifyOptions {
    unblinded: string;
    N: string;
    E: string;
    message: string;
  }

  function keyGeneration(options: KeyGenerationOptions): import('node-rsa');
  function messageToHash(message: string): string;
  function blind(options: BlindOptions): BlindResult;
  function unblind(options: UnblindOptions): BigInteger;
  function verify(options: VerifyOptions): boolean;
}
