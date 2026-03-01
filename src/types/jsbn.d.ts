declare module 'jsbn' {
  export class BigInteger {
    constructor(value: string, radix?: number);
    modPow(e: BigInteger, m: BigInteger): BigInteger;
    toString(radix?: number): string;
  }
}
