export type LogValue =
  | boolean
  | bigint
  | number
  | string
  | boolean[]
  | bigint[]
  | number[]
  | string[]
  | Uint8Array;

export interface StartControlRecordPayload {
  type: "start";
  entryId: number;
  entryName: string;
  entryType: string;
  metadata: string;
}

export interface FinishControlRecordPayload {
  type: "finish";
  entryId: number;
}

export interface SetMetadataControlRecordPayload {
  type: "set_metadata";
  entryId: number;
  metadata: string;
}

export type ControlRecordPayload =
  | StartControlRecordPayload
  | FinishControlRecordPayload
  | SetMetadataControlRecordPayload;

export interface WPILog {
  header: Header;
  entries: Entry[];
}

export interface Header {
  version: number;
  extra: string;
}

export interface Entry {
  id: number;
  name: string;
  type: string;
  metadata: string;
  records: BaseRecord[];
}

export interface BaseRecord {
  entryId: number;
  timestamp: bigint;
  rawPayload: LogValue;
}

export interface DataRecord extends BaseRecord {
  isControl: false;
  payload: LogValue;
}

export interface ControlRecord extends BaseRecord {
  isControl: true;
  payload: ControlRecordPayload;
}
