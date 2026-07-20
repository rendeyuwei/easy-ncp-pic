import { NcpParseError } from './errors';

export class BinaryReader {
  private readonly view: DataView;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get length(): number {
    return this.buf.byteLength;
  }

  uint8(offset: number): number {
    this.check(offset, 1);
    return this.view.getUint8(offset);
  }

  uint16BE(offset: number): number {
    this.check(offset, 2);
    return this.view.getUint16(offset, false);
  }

  uint32BE(offset: number): number {
    this.check(offset, 4);
    return this.view.getUint32(offset, false);
  }

  ascii(offset: number, length: number): string {
    this.check(offset, length);
    let s = '';
    for (let i = 0; i < length; i++) s += String.fromCharCode(this.view.getUint8(offset + i));
    return s;
  }

  bytes(offset: number, length: number): Uint8Array {
    this.check(offset, length);
    return this.buf.slice(offset, offset + length);
  }

  private check(offset: number, size: number): void {
    if (offset < 0 || offset + size > this.buf.byteLength) {
      throw new NcpParseError(
        'OUT_OF_BOUNDS',
        `read of ${size} byte(s) at offset ${offset} exceeds length ${this.buf.byteLength}`,
      );
    }
  }
}
