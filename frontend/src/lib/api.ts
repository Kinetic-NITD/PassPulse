/**
 * API client for PassPulse backend.
 * Includes automatic retry for GET requests and client-side caching.
 */

import { getCache, setCache, invalidateCache } from "./cache";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getToken(): string | null {
  if (typeof window !== "undefined") {
    return localStorage.getItem("passpulse_token");
  }
  return null;
}

export function setToken(token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("passpulse_token", token);
  }
}

export function removeToken(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("passpulse_token");
    localStorage.removeItem("passpulse_staff");
  }
}

export function getStaff(): any | null {
  if (typeof window !== "undefined") {
    const raw = localStorage.getItem("passpulse_staff");
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch { }
    }
  }
  return null;
}

export function setStaff(staff: any): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("passpulse_staff", JSON.stringify(staff));
  }
}

export function clearApiCache(): void {
  invalidateCache();
}

async function request(path: string, options: RequestInit = {}) {
  const method = (options.method || "GET").toUpperCase();
  const isRetryable = method === "GET";
  const maxAttempts = isRetryable ? 3 : 1;

  let lastErr: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const token = getToken();
      const headers: Record<string, string> = {
        ...(options.headers as Record<string, string>),
      };

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }

      const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

      if (
        isRetryable &&
        attempt < maxAttempts &&
        (res.status === 502 || res.status === 503 || res.status === 504)
      ) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }

      const contentType = res.headers.get("content-type") || "";
      let data: any = null;
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else if (contentType.includes("text/csv")) {
        data = await res.text();
      } else {
        data = await res.text();
      }

      if (!res.ok) {
        const error: any = new Error(
          data?.detail?.message || data?.detail || `HTTP ${res.status}`
        );
        error.status = res.status;
        error.detail = data?.detail;
        throw error;
      }

      return data;
    } catch (err: any) {
      lastErr = err;
      const isNetworkError = !err?.status;
      if (isRetryable && isNetworkError && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

async function cachedGet<T>(
  key: string,
  path: string,
  forceRefresh = false
): Promise<T> {
  if (!forceRefresh) {
    const hit = getCache<T>(key);
    if (hit !== null) return hit;
  }
  const data = await request(path, { method: "GET" });
  setCache(key, data);
  return data;
}

export const api = {
  login: (email: string, password: string) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  getPublicKeys: (): Promise<Record<string, string>> =>
    request("/api/public-keys", { method: "GET" }),

  scanTicket: (token: string) =>
    request("/api/scan", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  confirmTicket: (ticketId: string, idCardNo: string) =>
    request("/api/confirm", {
      method: "POST",
      body: JSON.stringify({ ticket_id: ticketId, id_card_no: idCardNo }),
    }),

  cancelTicket: (ticketId: string) =>
    request("/api/cancel", {
      method: "POST",
      body: JSON.stringify({ ticket_id: ticketId }),
    }),

  searchParticipants: (q: string) =>
    request(`/api/participants/search?q=${encodeURIComponent(q)}`, {
      method: "GET",
    }),

  listParticipants: (q: string = "", limit: number = 50, offset: number = 0, force = false) =>
    cachedGet<any>(
      `participants_${q}_${limit}_${offset}`,
      `/api/participants?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
      force
    ),

  getStats: (force = false) =>
    cachedGet<any>("stats", "/api/stats", force),

  getStaffList: (force = false) =>
    cachedGet<any>("staff", "/api/users", force),

  getScanLog: (limit: number = 50, offset: number = 0, force = false) =>
    cachedGet<any>(
      `scanlog_${limit}_${offset}`,
      `/api/scan-log?limit=${limit}&offset=${offset}`,
      force
    ),

  getTicketToken: (ticketId: string) =>
    request(`/api/tickets/${ticketId}/token`, { method: "GET" }),

  importParticipants: async (csvContent: string) => {
    const res = await request("/api/participants/import", {
      method: "POST",
      body: JSON.stringify({ csv_content: csvContent }),
    });
    invalidateCache();
    return res;
  },

  createParticipant: async (data: {
    name: string;
    email: string;
    college?: string;
    photo_url?: string;
    send_email?: boolean;
  }) => {
    const res = await request("/api/participants/create", {
      method: "POST",
      body: JSON.stringify(data),
    });
    invalidateCache();
    return res;
  },

  createStaff: async (data: {
    name: string;
    email: string;
    password: string;
    role: "volunteer" | "supervisor" | "admin";
  }) => {
    const res = await request("/api/users", {
      method: "POST",
      body: JSON.stringify(data),
    });
    invalidateCache("staff");
    return res;
  },

  updateStaff: async (
    userId: string,
    data: { role?: "volunteer" | "supervisor" | "admin"; active?: boolean; name?: string }
  ) => {
    const res = await request(`/api/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    invalidateCache("staff");
    return res;
  },

  deleteStaff: async (userId: string) => {
    const res = await request(`/api/users/${userId}`, { method: "DELETE" });
    invalidateCache("staff");
    return res;
  },

  issueTickets: async () => {
    const res = await request("/api/tickets/issue", {
      method: "POST",
      body: JSON.stringify({}),
    });
    invalidateCache();
    return res;
  },

  sendEmails: async (forceResend: boolean = false) => {
    const res = await request("/api/emails/send", {
      method: "POST",
      body: JSON.stringify({ force_resend: forceResend }),
    });
    invalidateCache();
    return res;
  },

  revokeTicket: async (ticketId: string, reason: string) => {
    const res = await request(`/api/tickets/${ticketId}/revoke`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    invalidateCache();
    return res;
  },

  reissueTicket: async (ticketId: string, reason: string) => {
    const res = await request(`/api/tickets/${ticketId}/reissue`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    invalidateCache();
    return res;
  },

  overrideTicket: (ticketId: string, action: string, reason: string, idCardNo?: string) =>
    request(`/api/tickets/${ticketId}/override`, {
      method: "POST",
      body: JSON.stringify({ action, reason, id_card_no: idCardNo }),
    }),

  // ─── Participant deletion ─────────────────────────────────
  deleteParticipant: async (participantId: string) => {
    const res = await request(`/api/participants/${participantId}`, {
      method: "DELETE",
    });
    invalidateCache();
    return res;
  },

  bulkDeleteParticipants: async (ids: string[]) => {
    const res = await request("/api/participants/delete-bulk", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    invalidateCache();
    return res;
  },

  // ─── Public ticket lookup (no auth needed but token is fine) ──
  getTicketByToken: (token: string) =>
    request(`/api/tickets/by-token/${encodeURIComponent(token)}`, { method: "GET" }),

    getEvent: (force = false) =>
    cachedGet<any>("event", "/api/event", force),

  updateEvent: async (name: string) => {
    const res = await request("/api/event", {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    invalidateCache("event");
    return res;
  },
};