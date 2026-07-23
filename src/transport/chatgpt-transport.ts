export type TransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type BinaryTransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
};

/**
 * Narrow transport seam for the read-only ChatGPT Web API endpoints.
 *
 * Implementations own authentication, browser/session state, and networking.
 * Callers only provide a same-origin backend path.
 */
export interface ChatGPTTransport {
  get(path: string): Promise<TransportResponse>;
  getBinary(
    url: string,
    maxBytes: number,
  ): Promise<BinaryTransportResponse>;
  close(): Promise<void>;
}
