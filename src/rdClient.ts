/**
 * Real-Debrid API wrapper. All calls use timeouts and must not throw on API errors.
 */

const BASE_URL = "https://api.real-debrid.com/rest/1.0";
const REQUEST_TIMEOUT_MS = 30_000;

export interface ApiHealthResult {
  success: boolean;
  responseTimeMs: number;
  httpStatus: number;
  error?: string;
}

export interface CacheAddResult {
  id: string;
  uri: string;
}

export interface CacheInfoResult {
  id: string;
  hash: string;
  status: string;
  links: string[];
  files?: { id: number; path: string; bytes: number; selected: number }[];
}

export interface UnrestrictResult {
  id: string;
  filename: string;
  download: string;
  host: string;
}

/** Instant availability: hash -> host -> array of file ID variants. */
export type InstantAvailabilityResponse = Record<
  string,
  Record<string, Record<string, { filename: string; filesize: number }[]>>
>;

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

/** GET /user — used for API health check. */
export async function checkUser(token: string): Promise<ApiHealthResult> {
  const start = Date.now();
  try {
    const res = await withTimeout(
      fetch(`${BASE_URL}/user`, {
        method: "GET",
        headers: { ...authHeader(token), Accept: "application/json" },
      }),
      REQUEST_TIMEOUT_MS
    );
    const responseTimeMs = Date.now() - start;
    const httpStatus = res.status;
    if (!res.ok) {
      let error: string | undefined;
      try {
        const body = await res.json();
        error = (body as { error?: string }).error;
      } catch {
        error = res.statusText;
      }
      return { success: false, responseTimeMs, httpStatus, error };
    }
    return { success: true, responseTimeMs, httpStatus };
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    return {
      success: false,
      responseTimeMs,
      httpStatus: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** GET /downloads — list user's downloads (for stream check by real-debrid.com/d/ID URL). */
export interface DownloadListItem {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  download: string;
  generated: string;
}

export async function getDownloadsList(
  token: string
): Promise<{
  success: boolean;
  downloads?: DownloadListItem[];
  httpStatus?: number;
  error?: string;
}> {
  try {
    const res = await withTimeout(
      fetch(`${BASE_URL}/downloads?limit=100`, {
        method: "GET",
        headers: { ...authHeader(token), Accept: "application/json" },
      }),
      REQUEST_TIMEOUT_MS
    );
    const httpStatus = res.status;
    if (!res.ok) {
      let error: string | undefined;
      try {
        const body = await res.json();
        error = (body as { error?: string }).error;
      } catch {
        error = res.statusText;
      }
      return { success: false, httpStatus, error };
    }
    const raw = (await res.json()) as Array<{
      id: string;
      filename: string;
      mimeType: string;
      filesize: number;
      link: string;
      host: string;
      download: string;
      generated: string;
    }>;
    const downloads: DownloadListItem[] = raw.map((d) => ({
      id: d.id,
      filename: d.filename,
      mimeType: d.mimeType,
      filesize: d.filesize,
      link: d.link,
      host: d.host,
      download: d.download,
      generated: d.generated,
    }));
    return { success: true, downloads };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** GET /torrents — list user's cached items by hash (for choosing hashes for streams.json). */
export interface CacheListItem {
  id: string;
  filename: string;
  hash: string;
  bytes: number;
  status: string;
  progress: number;
  added: string;
}

export async function getCacheList(
  token: string
): Promise<{
  success: boolean;
  items?: CacheListItem[];
  httpStatus?: number;
  error?: string;
}> {
  try {
    const res = await withTimeout(
      fetch(`${BASE_URL}/torrents?limit=100`, {
        method: "GET",
        headers: { ...authHeader(token), Accept: "application/json" },
      }),
      REQUEST_TIMEOUT_MS
    );
    const httpStatus = res.status;
    if (!res.ok) {
      let error: string | undefined;
      try {
        const body = await res.json();
        error = (body as { error?: string }).error;
      } catch {
        error = res.statusText;
      }
      return { success: false, httpStatus, error };
    }
    const raw = (await res.json()) as Array<{
      id: string;
      filename: string;
      hash: string;
      bytes: number;
      status: string;
      progress: number;
      added: string;
    }>;
    const items: CacheListItem[] = raw.map((t) => ({
      id: t.id,
      filename: t.filename,
      hash: t.hash,
      bytes: t.bytes,
      status: t.status,
      progress: t.progress,
      added: t.added,
    }));
    return { success: true, items };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** GET /torrents/instantAvailability/{hash} — check if hash is instantly available. */
export async function getInstantAvailability(
  token: string,
  hash: string
): Promise<{ available: boolean; data?: InstantAvailabilityResponse }> {
  try {
    const res = await withTimeout(
      fetch(`${BASE_URL}/torrents/instantAvailability/${hash}`, {
        method: "GET",
        headers: { ...authHeader(token), Accept: "application/json" },
      }),
      REQUEST_TIMEOUT_MS
    );
    if (!res.ok) {
      return { available: false };
    }
    const data = (await res.json()) as InstantAvailabilityResponse;
    const hashLower = hash.toLowerCase();
    const forHash = data[hashLower] ?? data[hash];
    if (!forHash || typeof forHash !== "object") return { available: false };
    const hosts = Object.keys(forHash);
    const hasFiles = hosts.some(
      (h) => Array.isArray(forHash[h]) && forHash[h].length > 0
    );
    return { available: hasFiles, data };
  } catch {
    return { available: false };
  }
}

/** Raw instant-availability check for debugging: returns full API response for one hash. */
export async function getInstantAvailabilityRaw(
  token: string,
  hash: string
): Promise<{
  success: boolean;
  httpStatus?: number;
  raw?: unknown;
  error?: string;
}> {
  try {
    const res = await withTimeout(
      fetch(`${BASE_URL}/torrents/instantAvailability/${hash}`, {
        method: "GET",
        headers: { ...authHeader(token), Accept: "application/json" },
      }),
      REQUEST_TIMEOUT_MS
    );
    const httpStatus = res.status;
    const raw = await res.json();
    if (!res.ok) {
      return { success: false, httpStatus, raw, error: (raw as { error?: string }).error };
    }
    return { success: true, httpStatus, raw };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** POST /torrents/addMagnet — add magnet by info hash. */
export async function addMagnet(
  token: string,
  hash: string
): Promise<{ success: boolean; id?: string; uri?: string; httpStatus?: number }> {
  const magnet = `magnet:?xt=urn:btih:${hash}`;
  try {
    const res = await withTimeout(
      fetch(`${BASE_URL}/torrents/addMagnet`, {
        method: "POST",
        headers: {
          ...authHeader(token),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ magnet }),
      }),
      REQUEST_TIMEOUT_MS
    );
    const httpStatus = res.status;
    if (res.status !== 201) {
      return { success: false, httpStatus };
    }
    const body = (await res.json()) as CacheAddResult;
    return { success: true, id: body.id, uri: body.uri, httpStatus };
  } catch {
    return { success: false };
  }
}

/** POST /torrents/selectFiles/{id} — select all files. */
export async function selectFiles(
  token: string,
  cacheId: string,
  files: string
): Promise<{ success: boolean; httpStatus?: number }> {
  try {
    const res = await withTimeout(
      fetch(`${BASE_URL}/torrents/selectFiles/${cacheId}`, {
        method: "POST",
        headers: {
          ...authHeader(token),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ files }),
      }),
      REQUEST_TIMEOUT_MS
    );
    const httpStatus = res.status;
    return { success: res.ok || res.status === 202, httpStatus };
  } catch {
    return { success: false };
  }
}

/** GET /torrents/info/{id} — get cache item info and links. */
export async function getCacheInfo(
  token: string,
  cacheId: string
): Promise<{
  success: boolean;
  info?: CacheInfoResult;
  httpStatus?: number;
}> {
  try {
    const res = await withTimeout(
      fetch(`${BASE_URL}/torrents/info/${cacheId}`, {
        method: "GET",
        headers: { ...authHeader(token), Accept: "application/json" },
      }),
      REQUEST_TIMEOUT_MS
    );
    const httpStatus = res.status;
    if (!res.ok) return { success: false, httpStatus };
    const info = (await res.json()) as CacheInfoResult;
    return { success: true, info, httpStatus };
  } catch {
    return { success: false };
  }
}

/** DELETE /torrents/delete/{id} — remove item from cache list. */
export async function deleteFromCache(
  token: string,
  cacheId: string
): Promise<void> {
  try {
    await withTimeout(
      fetch(`${BASE_URL}/torrents/delete/${cacheId}`, {
        method: "DELETE",
        headers: authHeader(token),
      }),
      REQUEST_TIMEOUT_MS
    );
  } catch {
    // ignore
  }
}

/** POST /unrestrict/link — unrestrict a host link. */
export async function unrestrictLink(
  token: string,
  link: string
): Promise<{
  success: boolean;
  download?: string;
  host?: string;
  httpStatus?: number;
}> {
  try {
    const res = await withTimeout(
      fetch(`${BASE_URL}/unrestrict/link`, {
        method: "POST",
        headers: {
          ...authHeader(token),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ link }),
      }),
      REQUEST_TIMEOUT_MS
    );
    const httpStatus = res.status;
    if (!res.ok) return { success: false, httpStatus };
    const body = (await res.json()) as UnrestrictResult;
    return {
      success: true,
      download: body.download,
      host: body.host,
      httpStatus,
    };
  } catch {
    return { success: false };
  }
}
