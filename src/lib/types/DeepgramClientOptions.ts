import { Fetch, FetchOptions } from "./Fetch";
import { ConnectionHealthOptions } from "./ConnectionHealthOptions";

export type IKeyFactory = () => string;
export type IFetch = typeof fetch;
export type IWebSocket = typeof WebSocket;

interface TransportFetchOptions extends TransportOptions, FetchOptions {}
interface TransportWebSocketOptions extends TransportOptions {
  _nodeOnlyHeaders?: { [index: string]: any };
}

type TransportUrl = string;

interface TransportOptions {
  url?: TransportUrl;
}

export interface RestOptions {
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface DeepgramClientOptions {
  global?: GlobalOptions;
  transcription?: RestOptions;
  preRecorded?: RestOptions;
  live?: RestOptions;
  read?: RestOptions;
  pricing?: RestOptions;
  manage?: RestOptions;
  members?: RestOptions;
  usage?: RestOptions;
  // ... existing options ...
}

interface GlobalOptions {
  key?: string;
  fetch?: IFetch;
  websocket?: IWebSocket;
  headers?: Record<string, string>;
  url?: string;
  retry?: RetryOptions;
}

export interface RetryOptions {
  minWait?: number;
  maxWait?: number;
  retries?: number;
  backoffFactor?: number;
}

export namespace DeepgramClientOptions {
  export interface NamespaceOptions extends RestOptions {
    connectionHealth?: ConnectionHealthOptions;
  }
}

export { DeepgramClientOptions };
