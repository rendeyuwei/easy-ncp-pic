import { BinaryReader } from './reader';
import { NcpParseError } from './errors';
import {
  OFF,
  NCP_SIGNATURE,
  NCP_ASCII_VERSION,
  SUPPORTED_MAJOR_VERSION,
  EXPECTED_LENGTH,
  HEADER_LENGTH_VALUE,
} from './constants';

export function validateStructure(reader: BinaryReader): void {
  if (reader.length !== EXPECTED_LENGTH) {
    throw new NcpParseError('BAD_LENGTH', `expected ${EXPECTED_LENGTH} bytes, got ${reader.length}`);
  }
  for (let i = 0; i < NCP_SIGNATURE.length; i++) {
    if (reader.uint8(OFF.signature + i) !== NCP_SIGNATURE[i]) {
      throw new NcpParseError('BAD_SIGNATURE', `byte ${i} is not part of the NCP signature`);
    }
  }
  const major = reader.uint32BE(OFF.majorVersion);
  if (major !== SUPPORTED_MAJOR_VERSION) {
    throw new NcpParseError('BAD_VERSION', `unsupported major version ${major}`);
  }
  const header = reader.uint32BE(OFF.headerLength);
  if (header !== HEADER_LENGTH_VALUE) {
    throw new NcpParseError('BAD_HEADER', `unexpected header length 0x${header.toString(16)}`);
  }
  const ascii = reader.ascii(OFF.asciiVersion, NCP_ASCII_VERSION.length);
  if (ascii !== NCP_ASCII_VERSION) {
    throw new NcpParseError('BAD_VERSION', `unexpected ascii version "${ascii}"`);
  }
}
