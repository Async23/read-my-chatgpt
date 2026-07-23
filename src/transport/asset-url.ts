import { isIP } from "node:net";

/**
 * Accept same-origin test/backend URLs and public HTTPS download URLs only.
 * The signed URL itself must stay inside the transport boundary.
 */
export function assertAllowedAssetUrl(
  baseUrl: string,
  value: string,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ChatGPT returned an invalid asset download URL");
  }

  const base = new URL(baseUrl);
  const sameOrigin = url.origin === base.origin;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateRemoteHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isIP(host) !== 0;

  if (
    url.username ||
    url.password ||
    url.hash ||
    (!sameOrigin && url.protocol !== "https:") ||
    (!sameOrigin && privateRemoteHost)
  ) {
    throw new Error("ChatGPT returned an unsafe asset download URL");
  }
  return url;
}
