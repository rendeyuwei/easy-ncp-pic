import { BinaryReader } from './reader';
import { OFF } from './constants';

export function readName(reader: BinaryReader): string {
  const bytes = reader.bytes(OFF.name, OFF.nameLength);
  const end = bytes.indexOf(0);
  const slice = end === -1 ? bytes : bytes.slice(0, end);
  let s = '';
  for (const b of slice) s += String.fromCharCode(b);
  return s;
}
