export type TokenMetadata = {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  website?: string;
  x?: string;
  telegram?: string;
  launchedBy?: string;
};

const decodeBase64Utf8 = (value: string): string => {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(value, "base64").toString("utf8");
};

const encodeBase64Utf8 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  if (typeof btoa === "function") {
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
};

/** Reads inline data: URIs only. Remote URIs are never fetched at request time. */
export const parseMetadataUri = (uri: string | null | undefined): TokenMetadata | null => {
  if (!uri) return null;
  try {
    if (uri.startsWith("data:application/json;base64,")) {
      return JSON.parse(decodeBase64Utf8(uri.slice("data:application/json;base64,".length))) as TokenMetadata;
    }
    if (uri.startsWith("data:application/json,")) {
      return JSON.parse(decodeURIComponent(uri.slice("data:application/json,".length))) as TokenMetadata;
    }
  } catch {
    return null;
  }
  return null;
};

export const buildMetadataUri = (metadata: TokenMetadata): string => {
  const clean = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => typeof value === "string" && value.trim() !== "").map(([key, value]) => [key, (value as string).trim()]),
  );
  return `data:application/json;base64,${encodeBase64Utf8(JSON.stringify(clean))}`;
};

/** Only http(s) images are rendered; anything else falls back to a generated avatar. */
export const safeImage = (image: string | undefined): string | null => {
  if (!image) return null;
  try {
    const url = new URL(image);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};
