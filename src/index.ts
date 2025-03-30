import { createReadStream } from "fs";
import { BaseRecord, ControlRecord, Entry, Header, WPILog } from "./types";

const td = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;

export class WPILogParser {
  private buffer: Uint8Array = new Uint8Array(0);
  private reader: DataView | null = null;
  private cursor: number = 0;
  private header: Header | null = null;

  constructor(private stream: AsyncIterable<Uint8Array | Buffer>) {}

  static fromLocalFile(filePath: string): WPILogParser {
    const fileStream = createReadStream(filePath);
    return new WPILogParser(fileStream);
  }

  private concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
  }

  private async readToBuffer(length: number, description?: string) {
    for (let i = 0; i < length; i++) {
      const result = await this.stream[Symbol.asyncIterator]().next();

      const chunk =
        result.value instanceof Buffer
          ? new Uint8Array(result.value)
          : result.value;

      this.buffer =
        this.buffer.length > 0
          ? this.concatUint8Arrays(this.buffer, chunk)
          : chunk;
      this.reader = new DataView(
        this.buffer.buffer,
        this.buffer.byteOffset,
        this.buffer.byteLength
      );
    }
  }

  private sliceBuffer(length: number) {
    if (length <= 0) return;
    if (length >= this.buffer.length) {
      this.buffer = new Uint8Array(0);
    } else {
      this.buffer = this.buffer.slice(length);
    }

    this.cursor = 0;
    this.reader = new DataView(
      this.buffer.buffer,
      this.buffer.byteOffset,
      this.buffer.byteLength
    );
  }

  private readBytes(length: number): Uint8Array {
    const start = this.cursor;
    this.cursor += length;
    return this.buffer.subarray(start, this.cursor);
  }

  private readU8(): number {
    const val = this.reader!.getUint8(this.cursor);
    this.cursor += 1;
    return val;
  }

  private readU16(): number {
    const val = this.reader!.getUint16(this.cursor, true);
    this.cursor += 2;
    return val;
  }

  private readU32(): number {
    const val = this.reader!.getUint32(this.cursor, true);
    this.cursor += 4;
    return val;
  }

  private readBigInt64(): bigint {
    const val = this.reader!.getBigInt64(this.cursor, true);
    this.cursor += 8;
    return val;
  }

  private readFloat32(): number {
    const val = this.reader!.getFloat32(this.cursor, true);
    this.cursor += 4;
    return val;
  }

  private readFloat64(): number {
    const val = this.reader!.getFloat64(this.cursor, true);
    this.cursor += 8;
    return val;
  }

  private readVariableLength(numBytes: number): number {
    switch (numBytes) {
      case 1:
        return this.readU8();
      case 2:
        return this.readU16();
      case 3: // Special case: 3 bytes LE
        const b1 = this.readU8();
        const b2 = this.readU8();
        const b3 = this.readU8();
        return b1 | (b2 << 8) | (b3 << 16);
      case 4:
        return this.readU32();
      default:
        throw new Error(`Invalid variable length size: ${numBytes}`);
    }
  }

  private readVariableLengthBigInt(numBytes: number): bigint {
    let value = BigInt(0);
    let shift = BigInt(0);
    for (let i = 0; i < numBytes; ++i) {
      const byte = BigInt(this.readU8());
      value |= byte << shift;
      shift += BigInt(8);
    }
    return value;
  }

  private parseVersion(bytes: number): [number, number] {
    const major = bytes >> 8;
    const minor = bytes & 0xff;
    if (major > 0xff || minor > 0xff) {
      throw new Error(`Invalid version: ${bytes}`);
    }
    return [major, minor];
  }

  private async parseHeader(): Promise<Header> {
    const HEADER_MIN_SIZE = 6 + 2 + 4;
    await this.readToBuffer(HEADER_MIN_SIZE, "header");

    const magicBytes = this.readBytes(6);
    const magic = String.fromCharCode(...magicBytes);
    if (magic !== "WPILOG") {
      throw new Error(
        `Invalid file. Are you sure this is a WPI Data Log file? Magic: ${magic}`
      );
    }

    const version = this.readU16();
    if (version !== 0x0100) {
      const [major, minor] = this.parseVersion(version);
      throw new Error(
        `Unsupported WPI Data Log version: ${major}.${minor}. Supported: 1.0`
      );
    }

    const extraLength = this.readU32();
    let extra = "";
    if (extraLength > 0) {
      await this.readToBuffer(extraLength, "extra header");
      const extraBytes = this.readBytes(extraLength);
      extra = td ? td.decode(extraBytes) : String.fromCharCode(...extraBytes);
      return { version, extra };
    }

    this.sliceBuffer(this.cursor);

    return {
      version,
      extra,
    };
  }

  private async parseRecord(): Promise<BaseRecord> {
    this.readToBuffer(1, "record bigfield");
    const bitField = this.readBytes(1);

    const entryIdLength = bitField[0] & 0b00000011;
    const payloadSizeLength = (bitField[0] >> 2) & 0b00000011;
    const timestampLength = (bitField[0] >> 4) & 0b00000111;

    this.readToBuffer(
      1 + entryIdLength + payloadSizeLength + timestampLength,
      "record header"
    );

    this.cursor += 1;
    const entryId = this.readVariableLength(entryIdLength);
    const payloadSize = this.readVariableLength(payloadSizeLength);
    const timestamp = this.readVariableLengthBigInt(timestampLength);

    this.readToBuffer(payloadSize, "record");

    const payloadBytes = this.readBytes(payloadSize);
    let record: BaseRecord;
    if (entryId === 0) {
      record = await this.parseControlRecord(payloadBytes, entryId, timestamp);
    }
  }

  private async parseControlRecord(
    payload: Uint8Array,
    entryId: number,
    timestamp: bigint
  ): Promise<ControlRecord> {}

  public async parseAll(): WPILog {
    this.header = await this.parseHeader();
    const entries: Entry[] = [];
  }
}
