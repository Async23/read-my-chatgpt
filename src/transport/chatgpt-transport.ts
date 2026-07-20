export type TransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

/**
 * Narrow transport seam for the read-only ChatGPT Web API endpoints.
 *
 * Implementations own authentication, browser/session state, and networking.
 * Callers only provide a same-origin backend path.
 */
export interface ChatGPTTransport {
  get(path: string): Promise<TransportResponse>;
  close(): Promise<void>;
}
