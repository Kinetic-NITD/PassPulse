/**
 * API client for PassPulse backend.
 */

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

async function request(path: string, options: RequestInit = {}) {
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

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

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
    const error: any = new Error(data?.detail?.message || data?.detail || `HTTP ${res.status}`);
    error.status = res.status;
    error.detail = data?.detail;
    throw error;
  }

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
    request(`/api/participants/search?q=${encodeURIComponent(q)}`, { method: "GET" }),

  listParticipants: (q: string = "", limit: number = 50, offset: number = 0) =>
    request(`/api/participants?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`, { method: "GET" }),

  getStats: () =>
    request("/api/stats", { method: "GET" }),

  getTicketToken: (ticketId: string) =>
    request(`/api/tickets/${ticketId}/token`, { method: "GET" }),

  getScanLog: (limit: number = 50, offset: number = 0) =>
    request(`/api/scan-log?limit=${limit}&offset=${offset}`, { method: "GET" }),

  getStaffList: () =>
    request("/api/users", { method: "GET" }),

  importParticipants: (csvContent: string) =>
    request("/api/participants/import", {
      method: "POST",
      body: JSON.stringify({ csv_content: csvContent }),
    }),

  createParticipant: (data: {
    name: string;
    email: string;
    college?: string;
    photo_url?: string;
    send_email?: boolean;
  }) =>
    request("/api/participants/create", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  createStaff: (data: {
    name: string;
    email: string;
    password: string;
    role: "volunteer" | "supervisor" | "admin";
  }) =>
    request("/api/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  issueTickets: () =>
    request("/api/tickets/issue", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  sendEmails: (forceResend: boolean = false) =>
    request("/api/emails/send", {
      method: "POST",
      body: JSON.stringify({ force_resend: forceResend }),
    }),

  revokeTicket: (ticketId: string, reason: string) =>
    request(`/api/tickets/${ticketId}/revoke`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  reissueTicket: (ticketId: string, reason: string) =>
    request(`/api/tickets/${ticketId}/reissue`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  overrideTicket: (ticketId: string, action: string, reason: string, idCardNo?: string) =>
    request(`/api/tickets/${ticketId}/override`, {
      method: "POST",
      body: JSON.stringify({ action, reason, id_card_no: idCardNo }),
    }),
};