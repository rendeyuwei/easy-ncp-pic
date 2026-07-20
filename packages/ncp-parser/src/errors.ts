export type NcpErrorCode =
  | 'BAD_SIGNATURE'
  | 'BAD_LENGTH'
  | 'BAD_VERSION'
  | 'BAD_HEADER'
  | 'OUT_OF_BOUNDS'
  | 'BAD_POINT_COUNT'
  | 'UNORDERED_POINTS'
  | 'LUT_OUT_OF_RANGE';

export class NcpParseError extends Error {
  readonly code: NcpErrorCode;
  constructor(code: NcpErrorCode, message: string) {
    super(message);
    this.name = 'NcpParseError';
    this.code = code;
  }
}
