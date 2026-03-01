declare module 'node-rsa' {
  import { BigInteger } from 'jsbn';

  interface KeyPair {
    n: BigInteger;
    e: BigInteger;
    d: BigInteger;
  }

  class NodeRSA {
    constructor(pem?: string);
    keyPair: KeyPair;
    exportKey(format: string): string;
  }

  export = NodeRSA;
}
