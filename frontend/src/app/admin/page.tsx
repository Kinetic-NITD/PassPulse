"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { api, getStaff, removeToken, getToken, API_BASE } from "@/lib/api";

const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif';

const T = {
  bg: "#F5F5F7",
  card: "#FFFFFF",
  text: "#1D1D1F",
  textSec: "#6E6E73",
  textTer: "#8E8E93",
  blue: "#007AFF",
  green: "#34C759",
  greenBg: "#E8F9EE",
  greenText: "#1B7A37",
  orange: "#FF9500",
  orangeBg: "#FFF4E5",
  red: "#FF3B30",
  redBg: "#FEECEB",
  purple: "#AF52DE",
  purpleBg: "#F5EDFB",
  border: "rgba(0,0,0,0.08)",
  borderSoft: "rgba(0,0,0,0.04)",
  shadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)",
  shadowLg: "0 4px 20px rgba(0,0,0,0.08)",
};

const AVATAR_COLORS = [
  "#FF9500", "#34C759", "#007AFF", "#AF52DE",
  "#FF2D55", "#5AC8FA", "#FFCC00", "#5856D6",
];

const PAGE_SIZE = 15;

type TabKey = "participants" | "volunteers" | "analytics";

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const Icon = {
  Bell: (p: any) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>,
  Search: (p: any) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>,
  Plus: (p: any) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 5v14M5 12h14" /></svg>,
  Upload: (p: any) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>,
  UploadCloud: (p: any) => <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3" /><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /></svg>,
  Download: (p: any) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  DownloadCloud: (p: any) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="8 17 12 21 16 17" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" /></svg>,
  Sync: (p: any) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9 9 9 0 0 1 9 9z" /><path d="M21 3v6h-6" /></svg>,
  Check: (p: any) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="20 6 9 17 4 12" /></svg>,
  Copy: (p: any) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
  Qr: (p: any) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM21 14v3M14 21h3M21 21h.01" /></svg>,
  IdCard: (p: any) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="12" r="2" /><path d="M14 10h4M14 14h4" /></svg>,
  Users: (p: any) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  Clock: (p: any) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  Shield: (p: any) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
  X: (p: any) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>,
  File: (p: any) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>,
  Lock: (p: any) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>,
  Alert: (p: any) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  IdCardTab: (p: any) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="12" r="2" /><path d="M14 10h4M14 14h4" /></svg>,
  UsersTab: (p: any) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>,
  ChartTab: (p: any) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 3v18h18" /><path d="m7 14 4-4 4 4 6-6" /></svg>,
  ChevronLeft: (p: any) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="15 18 9 12 15 6" /></svg>,
  ChevronRight: (p: any) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="9 18 15 12 9 6" /></svg>,
  Edit: (p: any) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
  Trash: (p: any) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>,
  LogOut: (p: any) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>,
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span style={{ fontSize: 12, color: T.textTer, fontWeight: 500 }}>No pass</span>;
  const s: Record<string, { bg: string; fg: string; label: string }> = {
    checked_in: { bg: T.greenBg, fg: T.greenText, label: "Checked-In" },
    issued: { bg: "#EBF4FE", fg: "#0055B8", label: "Issued • Awaiting" },
    pending: { bg: T.orangeBg, fg: "#8A5B00", label: "Pending Scan" },
    revoked: { bg: T.redBg, fg: "#C62828", label: "Revoked • Invalid" },
  };
  const v = s[status] || { bg: "#E5E5EA", fg: "#48484A", label: status };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, backgroundColor: v.bg, color: v.fg, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: v.fg }} />
      {v.label}
    </span>
  );
}

function RolePill({ role }: { role: string }) {
  const c: Record<string, { bg: string; fg: string; label: string }> = {
    admin: { bg: T.purpleBg, fg: T.purple, label: "Admin" },
    supervisor: { bg: "#EBF4FE", fg: "#0055B8", label: "Supervisor" },
    volunteer: { bg: T.greenBg, fg: T.greenText, label: "Volunteer" },
  };
  const v = c[role] || { bg: "#E5E5EA", fg: "#48484A", label: role };
  return (
    <span style={{ display: "inline-block", padding: "4px 12px", borderRadius: 20, backgroundColor: v.bg, color: v.fg, fontSize: 12, fontWeight: 700 }}>
      {v.label}
    </span>
  );
}

function StatCard({ label, value, sub, icon, accent, bar, barPct, badge }: any) {
  return (
    <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: 20, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.textSec, letterSpacing: 0.5 }}>{label}</span>
        {badge ? (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, backgroundColor: badge === "ALERT" ? T.redBg : T.greenBg, color: badge === "ALERT" ? "#C62828" : T.greenText }}>{badge}</span>
        ) : (
          <span style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: `${accent}12`, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>
        )}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: T.text, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: T.textSec, marginTop: 6 }}>{sub}</div>
      {bar && (
        <div style={{ height: 4, backgroundColor: "#E5E5EA", borderRadius: 2, overflow: "hidden", marginTop: 12 }}>
          <div style={{ height: "100%", width: `${Math.min(100, barPct || 0)}%`, backgroundColor: accent }} />
        </div>
      )}
    </div>
  );
}

function Modal({ children, onClose, width = 500 }: any) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#fff", borderRadius: 20, padding: 24, maxWidth: width, width: "100%", maxHeight: "92vh", overflowY: "auto", fontFamily: FONT, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        {children}
      </div>
    </div>
  );
}

function CopyBlock({ label, value, onCopy, highlight, subtle }: any) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textTer, letterSpacing: 0.5, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, backgroundColor: highlight ? "#EBF4FE" : T.bg, padding: "8px 12px", borderRadius: 10, border: highlight ? "1px solid rgba(0,122,255,0.2)" : "none" }}>
        <code style={{ flex: 1, fontSize: subtle ? 10 : 11, fontFamily: "ui-monospace, monospace", wordBreak: "break-all", color: highlight ? "#0055B8" : T.textSec, fontWeight: highlight ? 600 : 500 }}>{value}</code>
        <button onClick={onCopy} style={{ border: "none", background: "none", cursor: "pointer", color: highlight ? T.blue : T.textSec, padding: 4, display: "flex", alignItems: "center" }}><Icon.Copy /></button>
      </div>
    </div>
  );
}

function ActionIconButton({ title, onClick, icon, tone = "default" }: any) {
  const colors = { default: { bg: T.bg, fg: T.textSec }, red: { bg: T.redBg, fg: T.red }, blue: { bg: "#EBF4FE", fg: T.blue } }[tone as "default" | "red" | "blue"];
  return (
    <button title={title} onClick={onClick} style={{ width: 32, height: 32, borderRadius: 8, border: "none", cursor: "pointer", backgroundColor: colors.bg, color: colors.fg, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {icon}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.12)", fontSize: 14, outline: "none",
  marginBottom: 14, fontFamily: "inherit", backgroundColor: "#fff", color: "#1D1D1F",
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (field || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ""; }
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else field += c;
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

interface ParsedRow {
  rowNum: number;
  name: string;
  email: string;
  college: string;
  tier: string;
  status: "valid" | "duplicate" | "field_error";
  statusLabel: string;
  duplicateBatch?: number;
}

function analyzeCsv(text: string): ParsedRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    name: header.indexOf("name"),
    email: header.indexOf("email"),
    college: header.indexOf("college"),
    tier: header.indexOf("ticket_tier"),
  };
  const seen = new Map<string, number>();
  const out: ParsedRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = idx.name >= 0 ? (r[idx.name] || "").trim() : "";
    const email = idx.email >= 0 ? (r[idx.email] || "").trim().toLowerCase() : "";
    const college = idx.college >= 0 ? (r[idx.college] || "").trim() : "";
    const tier = idx.tier >= 0 ? (r[idx.tier] || "").trim() : "General Pass";

    let status: ParsedRow["status"] = "valid";
    let statusLabel = "Valid";
    let duplicateBatch: number | undefined;

    if (!name || !email || !email.includes("@")) {
      status = "field_error";
      statusLabel = !name ? "Missing Name" : !email ? "Missing Email" : "Invalid Email";
    } else if (seen.has(email)) {
      status = "duplicate";
      duplicateBatch = seen.get(email)!;
      statusLabel = `Duplicate Email (Batch #${String(duplicateBatch).padStart(2, "0")})`;
    } else {
      seen.set(email, out.filter((x) => x.status !== "field_error").length + 1);
    }

    out.push({ rowNum: i, name, email, college, tier, status, statusLabel, duplicateBatch });
  }
  return out;
}

function BulkCsvUploader({ onImported, onCancel, onClose }: { onImported: () => void; onCancel: () => void; onClose: () => void }) {
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [csvText, setCsvText] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [autoEmail, setAutoEmail] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const validCount = rows.filter((r) => r.status === "valid").length;
  const duplicateCount = rows.filter((r) => r.status === "duplicate").length;
  const errorCount = rows.filter((r) => r.status === "field_error").length;

  const reset = () => {
    setFileName(""); setFileSize(0); setCsvText(""); setRows([]);
    setError(null); setImportResult(null); setShowAll(false);
  };

  const handleFile = async (file: File) => {
    setError(null);
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      setError("XLSX not supported client-side — please export as CSV and try again.");
      return;
    }
    if (!name.endsWith(".csv") && !name.endsWith(".txt")) {
      setError("Please provide a .csv file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File exceeds 10 MB limit.");
      return;
    }
    try {
      const text = await file.text();
      setFileName(file.name); setFileSize(file.size);
      setCsvText(text); setRows(analyzeCsv(text)); setImportResult(null);
    } catch {
      setError("Could not read file.");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const handleConfirm = async () => {
    if (!csvText.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.importParticipants(csvText);
      if (autoEmail && res.imported > 0) {
        try { await api.sendEmails(false); } catch { }
      }
      setImportResult(res);
      onImported();
    } catch (err: any) {
      setError(err?.detail?.message || err?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const csv = "name,email,college,photo_url\nElena Rostova,elena@stanford.edu,Stanford University,\nMarcus Chen,mchen@mit.edu,MIT,\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "passpulse_participants_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const statusPill = (row: ParsedRow) => {
    if (row.status === "valid") {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20, backgroundColor: T.greenBg, color: T.greenText, fontSize: 12, fontWeight: 700 }}>
          Valid <span style={{ fontSize: 14 }}>✓</span>
        </span>
      );
    }
    if (row.status === "duplicate") {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20, backgroundColor: T.redBg, color: "#C62828", fontSize: 12, fontWeight: 700 }}>
          <Icon.Alert /> {row.statusLabel}
        </span>
      );
    }
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20, backgroundColor: "#FFF4E5", color: "#8A5B00", fontSize: 12, fontWeight: 700 }}>
        <Icon.Alert /> {row.statusLabel}
      </span>
    );
  };

  const previewRows = showAll ? rows : rows.slice(0, 5);

  if (importResult) {
    return (
      <div>
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", backgroundColor: T.greenBg, color: T.green, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 28, marginBottom: 14 }}>✓</div>
          <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Import Complete</h3>
          <p style={{ fontSize: 14, color: T.textSec }}>Your roster has been updated.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 20 }}>
          <div style={{ padding: 16, borderRadius: 12, backgroundColor: T.greenBg }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.greenText, letterSpacing: 0.5 }}>IMPORTED</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: T.greenText }}>{importResult.imported}</div>
          </div>
          <div style={{ padding: 16, borderRadius: 12, backgroundColor: T.orangeBg }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8A5B00", letterSpacing: 0.5 }}>DUPLICATES</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#8A5B00" }}>{importResult.duplicates}</div>
          </div>
          <div style={{ padding: 16, borderRadius: 12, backgroundColor: T.redBg }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#C62828", letterSpacing: 0.5 }}>ERRORS</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#C62828" }}>{importResult.errors}</div>
          </div>
        </div>
        <button onClick={onClose} style={{ marginTop: 24, width: "100%", padding: 14, borderRadius: 12, border: "none", backgroundColor: T.blue, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: "#EBF4FE", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon.Upload style={{ color: T.blue, width: 20, height: 20 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ fontSize: 22, fontWeight: 700 }}>Add Participants</h3>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "3px 8px", borderRadius: 6, backgroundColor: "#EBF4FE", color: "#0055B8" }}>HS25 NODE</span>
          </div>
        </div>
        <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: T.textSec, padding: 6 }}>
          <Icon.X />
        </button>
      </div>
      <p style={{ fontSize: 13, color: T.textSec, marginBottom: 18 }}>
        Issue tickets with cryptographically signed QR codes instantly to gate devices.
      </p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, padding: 4, backgroundColor: T.bg, borderRadius: 10 }}>
          <span style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, color: T.textSec, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon.Users style={{ width: 14, height: 14 }} /> Individual Participant
          </span>
          <span style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: T.text, backgroundColor: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon.File style={{ width: 14, height: 14 }} /> Bulk CSV Upload
            <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: T.blue }} />
          </span>
        </div>
        <span style={{ fontSize: 11, color: T.textSec, display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
          <Icon.Lock /> SHA-256 HMAC Signatures Ready
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: fileName ? "1.4fr 1fr" : "1fr", gap: 16, marginBottom: 18 }}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? T.blue : "rgba(0,0,0,0.15)"}`,
            borderRadius: 16, padding: "36px 20px", textAlign: "center",
            backgroundColor: dragging ? "#EBF4FE" : "#FAFAFB",
            cursor: "pointer", transition: "all 0.15s",
          }}
        >
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 68, height: 68, borderRadius: 16, backgroundColor: "#fff", border: `1px solid ${T.border}`, marginBottom: 14 }}>
            <Icon.UploadCloud style={{ color: T.blue }} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            {fileName ? "Drop a new file to replace" : "Drop your .csv file here"}
          </div>
          <div style={{ fontSize: 13, color: T.textSec, marginBottom: 16 }}>
            or <span style={{ color: T.blue, fontWeight: 600 }}>browse files</span> from workstation
          </div>
          <div style={{ fontSize: 11, color: T.textTer, display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
            <span>Up to 5,000 rows</span>
            <span>•</span>
            <span>Max 10MB</span>
            <span>•</span>
            <span>UTF-8 strictly encoded</span>
          </div>
        </div>

        {fileName && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, backgroundColor: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: "#EBF4FE", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon.File style={{ color: T.blue }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {fileName.length > 26 ? fileName.slice(0, 23) + "…" : fileName}
                  </div>
                  <div style={{ fontSize: 11, color: T.textSec }}>
                    {(fileSize / 1024).toFixed(0)} KB • {rows.length} records parsed
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.greenText, backgroundColor: T.greenBg, padding: "3px 10px", borderRadius: 20 }}>
                  Parsed
                </span>
              </div>
              <div style={{ height: 4, backgroundColor: "#E5E5EA", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: "100%", backgroundColor: T.blue }} />
              </div>
            </div>

            <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, backgroundColor: "#FAFAFB" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.textTer, letterSpacing: 0.7, marginBottom: 10 }}>
                SPECIFICATION BOILERPLATE
              </div>
              <button onClick={downloadTemplate} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: FONT, color: T.text, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}>
                <Icon.DownloadCloud /> Download CSV Template (.csv)
                <span style={{ color: T.textTer, fontWeight: 500 }}>1.4 KB</span>
              </button>
              <div style={{ fontSize: 11, color: T.textSec, fontFamily: "ui-monospace, monospace" }}>
                Columns: name, email, college, photo_url
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 10, backgroundColor: T.redBg, color: "#C62828", fontSize: 13, fontWeight: 600, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon.Alert /> {error}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", backgroundColor: "#FAFAFB", borderRadius: 12, marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textSec }}>Parsed Breakdown:</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", borderRadius: 20, backgroundColor: "#fff", border: `1px solid ${T.border}`, fontSize: 12, fontWeight: 700 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: T.text }} />
                {validCount} Valid Rows
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", borderRadius: 20, backgroundColor: "#fff", border: `1px solid ${T.border}`, fontSize: 12, fontWeight: 700, color: "#C62828" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: T.red }} />
                {duplicateCount} Duplicates
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", borderRadius: 20, backgroundColor: "#fff", border: `1px solid ${T.border}`, fontSize: 12, fontWeight: 700, color: "#8A5B00" }}>
                <Icon.Alert /> {errorCount} Field Errors
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Data Verification Grid</span>
            <span style={{ fontSize: 12, color: T.textSec, display: "flex", alignItems: "center", gap: 6 }}>
              Live Row Validation Pipeline
              <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: T.green }} />
            </span>
          </div>

          <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 18 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: "#FAFAFB" }}>
                    {["#", "ATTENDEE NAME", "EMAIL ADDRESS", "COLLEGE / AFFILIATION", "TIER / CATEGORY", "VERIFICATION STATUS"].map((h) => (
                      <th key={h} style={{ padding: "12px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: T.textTer, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => {
                    const isError = row.status !== "valid";
                    return (
                      <tr key={row.rowNum} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                        <td style={{ padding: "12px 14px", fontSize: 11, color: T.textTer, fontFamily: "ui-monospace, monospace" }}>{String(row.rowNum).padStart(3, "0")}</td>
                        <td style={{ padding: "12px 14px", fontWeight: 600, color: isError ? "#C62828" : T.text }}>
                          {row.name || <span style={{ color: T.red, fontStyle: "italic" }}>[Empty Name]</span>}
                        </td>
                        <td style={{ padding: "12px 14px", color: isError ? "#C62828" : T.textSec, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                          {row.email || <span style={{ color: T.orange, fontStyle: "italic" }}>[Empty Email]</span>}
                        </td>
                        <td style={{ padding: "12px 14px", color: row.college ? T.text : T.orange, fontSize: 12, fontStyle: row.college ? "normal" : "italic" }}>
                          {row.college || "[Empty College]"}
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: 12 }}>
                          <span style={{ padding: "3px 10px", borderRadius: 20, backgroundColor: T.bg, fontWeight: 600 }}>{row.tier}</span>
                        </td>
                        <td style={{ padding: "12px 14px" }}>{statusPill(row)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > 5 && (
              <div style={{ padding: "12px 16px", backgroundColor: "#FAFAFB", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, flexWrap: "wrap", gap: 8 }}>
                <span style={{ color: T.textSec }}>
                  Showing {showAll ? rows.length : "initial 5"} test sample records out of {rows.length}
                </span>
                <button onClick={() => setShowAll((s) => !s)} style={{ border: "none", background: "none", cursor: "pointer", color: T.blue, fontWeight: 600, fontSize: 12, fontFamily: FONT, padding: 0 }}>
                  {showAll ? "Collapse Grid" : "Full Grid Expansion"}
                </button>
              </div>
            )}
          </div>

          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={autoEmail} onChange={(e) => setAutoEmail(e.target.checked)} style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                  Automatically email secure QR entry passes to valid participants immediately
                </span>
              </label>
              {duplicateCount + errorCount > 0 && (
                <span style={{ fontSize: 13, color: "#C62828", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon.Alert /> {duplicateCount + errorCount} rows with errors will be skipped
                </span>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={reset} style={{ padding: "12px 24px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: FONT, color: T.text, display: "flex", alignItems: "center", gap: 8 }}>
                Cancel / Re-upload
              </button>
              <button onClick={handleConfirm} disabled={importing || validCount === 0} style={{ padding: "12px 26px", borderRadius: 12, border: "none", backgroundColor: T.blue, color: "#fff", cursor: importing || validCount === 0 ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, fontFamily: FONT, display: "flex", alignItems: "center", gap: 8, opacity: importing || validCount === 0 ? 0.5 : 1, boxShadow: "0 4px 12px rgba(0,122,255,0.25)" }}>
                {importing ? "Importing…" : "Confirm & Import Participants"}
              </button>
            </div>
          </div>
        </>
      )}

      {rows.length === 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
          <button onClick={onCancel} style={{ padding: "12px 24px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: FONT, color: T.text }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("participants");

  const [stats, setStats] = useState<any>({
    participants: 0,
    tickets: { total: 0, issued: 0, pending: 0, checked_in: 0, revoked: 0 },
  });

  const [participants, setParticipants] = useState<any[]>([]);
  const [participantTotal, setParticipantTotal] = useState(0);
  const [participantPage, setParticipantPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const [volunteers, setVolunteers] = useState<any[]>([]);
  const [volunteersLoading, setVolunteersLoading] = useState(false);
  const [volunteersError, setVolunteersError] = useState<string | null>(null);
  const [scanLogs, setScanLogs] = useState<any[]>([]);

  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [addTab, setAddTab] = useState<"individual" | "bulk">("individual");
  const [creating, setCreating] = useState(false);
  const [newParticipant, setNewParticipant] = useState({
    name: "", email: "", college: "", photo_url: "", send_email: false,
  });

  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({
    name: "", email: "", password: "",
    role: "volunteer" as "volunteer" | "supervisor" | "admin",
  });

  const [editingStaff, setEditingStaff] = useState<any | null>(null);
  const [editRole, setEditRole] = useState<"volunteer" | "supervisor" | "admin">("volunteer");
  const [editActive, setEditActive] = useState(true);
  const [deletingStaff, setDeletingStaff] = useState<any | null>(null);
  const [staffActionBusy, setStaffActionBusy] = useState(false);

  const [createdTicket, setCreatedTicket] = useState<any | null>(null);

  const [actionTicketId, setActionTicketId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"revoke" | "reissue" | null>(null);
  const [actionReason, setActionReason] = useState("");

  // ─── Participant deletion state ───────────────────────────────
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [deletingParticipant, setDeletingParticipant] = useState<any | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 820);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const currentStaff = getStaff();
    if (!currentStaff) { router.replace("/login"); return; }
    if (currentStaff.role !== "admin") { router.replace("/scanner"); return; }
    setStaff(currentStaff);
  }, [router]);

  const loadStats = useCallback(async (force = false) => {
    try { setStats(await api.getStats(force)); } catch (e) { console.error(e); }
  }, []);

  const loadParticipants = useCallback(async (force = false) => {
    try {
      const offset = participantPage * PAGE_SIZE;
      const data = await api.listParticipants(searchQuery, PAGE_SIZE, offset, force);
      setParticipants(data.participants || []);
      setParticipantTotal(data.total || 0);
    } catch (e) { console.error(e); }
  }, [searchQuery, participantPage]);

  const loadVolunteers = useCallback(async (force = false) => {
    setVolunteersLoading(true);
    setVolunteersError(null);
    try {
      const data = await api.getStaffList(force);
      setVolunteers(data.staff || []);
    } catch (e: any) {
      console.error("loadVolunteers failed:", e);
      setVolunteersError(e?.detail?.message || e?.message || "Failed to load staff");
    } finally {
      setVolunteersLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async (force = false) => {
    try {
      const data = await api.getScanLog(30, 0, force);
      setScanLogs(data.logs || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    if (!staff) return;
    loadStats();
  }, [staff, loadStats]);

  useEffect(() => {
    if (!staff || activeTab !== "participants") return;
    loadParticipants();
  }, [staff, activeTab, participantPage, searchQuery, loadParticipants]);

  useEffect(() => {
    if (!staff || activeTab !== "volunteers") return;
    loadVolunteers();
  }, [staff, activeTab, loadVolunteers]);

  useEffect(() => {
    if (!staff || activeTab !== "analytics") return;
    loadAnalytics();
  }, [staff, activeTab, loadAnalytics]);

  const refresh = (force = false) => {
    loadStats(force);
    if (activeTab === "participants") loadParticipants(force);
    else if (activeTab === "volunteers") loadVolunteers(force);
    else if (activeTab === "analytics") loadAnalytics(force);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParticipantPage(0);
  };

  const handleExportCsv = async () => {
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/tickets/export-csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "participants_qr_pass_urls.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || "Export failed");
    }
  };

  const handleCreateParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newParticipant.name.trim() || !newParticipant.email.trim()) return;
    setCreating(true);
    try {
      const res = await api.createParticipant({
        name: newParticipant.name.trim(),
        email: newParticipant.email.trim(),
        college: newParticipant.college.trim() || undefined,
        photo_url: newParticipant.photo_url.trim() || undefined,
        send_email: newParticipant.send_email,
      });
      setCreatedTicket({ ...res, qr_png_url: res.qr_png_url || `/api/tickets/${res.ticket.id}/qr.png` });
      setShowAddParticipant(false);
      setNewParticipant({ name: "", email: "", college: "", photo_url: "", send_email: false });
      loadStats(true);
      loadParticipants(true);
    } catch (err: any) {
      alert("Create failed: " + (err.detail?.message || err.message));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaff.name.trim() || !newStaff.email.trim() || !newStaff.password) return;
    setCreating(true);
    try {
      await api.createStaff({
        name: newStaff.name.trim(),
        email: newStaff.email.trim(),
        password: newStaff.password,
        role: newStaff.role,
      });
      alert(`Created ${newStaff.role}: ${newStaff.name}`);
      setShowAddStaff(false);
      setNewStaff({ name: "", email: "", password: "", role: "volunteer" });
      loadVolunteers(true);
    } catch (err: any) {
      alert("Create failed: " + (err.detail?.message || err.message));
    } finally {
      setCreating(false);
    }
  };

  const openEditStaff = (v: any) => {
    setEditingStaff(v);
    setEditRole(v.role);
    setEditActive(v.active);
  };

  const handleUpdateStaff = async () => {
    if (!editingStaff) return;
    setStaffActionBusy(true);
    try {
      await api.updateStaff(editingStaff.id, { role: editRole, active: editActive });
      setEditingStaff(null);
      loadVolunteers(true);
    } catch (err: any) {
      alert("Update failed: " + (err.detail?.message || err.message));
    } finally {
      setStaffActionBusy(false);
    }
  };

  const handleDeleteStaff = async () => {
    if (!deletingStaff) return;
    setStaffActionBusy(true);
    try {
      await api.deleteStaff(deletingStaff.id);
      setDeletingStaff(null);
      loadVolunteers(true);
    } catch (err: any) {
      alert("Delete failed: " + (err.detail?.message || err.message));
    } finally {
      setStaffActionBusy(false);
    }
  };

  // ─── Participant delete handlers ──────────────────────────────
  const toggleParticipantSelected = (id: string) => {
    setSelectedParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedParticipants.size === participants.length && participants.length > 0) {
      setSelectedParticipants(new Set());
    } else {
      setSelectedParticipants(new Set(participants.map((p) => p.id)));
    }
  };

  const handleDeleteParticipant = async () => {
    if (!deletingParticipant) return;
    setDeleteBusy(true);
    try {
      await api.deleteParticipant(deletingParticipant.id);
      setSelectedParticipants((prev) => {
        const next = new Set(prev);
        next.delete(deletingParticipant.id);
        return next;
      });
      setDeletingParticipant(null);
      loadStats(true);
      loadParticipants(true);
    } catch (err: any) {
      alert("Delete failed: " + (err.detail?.message || err.message));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedParticipants.size === 0) return;
    setDeleteBusy(true);
    try {
      const res = await api.bulkDeleteParticipants(Array.from(selectedParticipants));
      alert(`Deleted ${res.deleted} participant(s)`);
      setSelectedParticipants(new Set());
      setBulkDeleteOpen(false);
      loadStats(true);
      loadParticipants(true);
    } catch (err: any) {
      alert("Bulk delete failed: " + (err.detail?.message || err.message));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleShowQr = async (p: any) => {
    try {
      const data = await api.getTicketToken(p.ticket_id);
      setCreatedTicket({
        participant: { name: p.name, email: p.email, college: p.college },
        ticket: { id: data.ticket_id, status: data.status },
        token: data.token,
        qr_url: data.url,
        qr_png_url: `/api/tickets/${p.ticket_id}/qr.png`,
        email_sent: !!p.email_sent_at,
      });
    } catch (err: any) {
      alert("Failed to load QR: " + (err.detail?.message || err.message));
    }
  };

  const handleTicketAction = async () => {
    if (!actionTicketId || !actionType || !actionReason.trim()) return;
    try {
      if (actionType === "revoke") await api.revokeTicket(actionTicketId, actionReason.trim());
      else await api.reissueTicket(actionTicketId, actionReason.trim());
      setActionTicketId(null); setActionType(null); setActionReason("");
      loadStats(true); loadParticipants(true);
    } catch (err: any) {
      alert(`Action failed: ${err.message}`);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    alert(`${label} copied`);
  };

  const handleLogout = () => {
    if (!confirm("Log out of PassPulse?")) return;
    removeToken();
    router.push("/login");
  };

  if (!staff) return null;

  const checkedIn = stats.tickets?.checked_in || 0;
  const pending = (stats.tickets?.issued || 0) + (stats.tickets?.pending || 0);
  const invalid = stats.tickets?.revoked || 0;
  const total = stats.participants || 0;
  const checkinRate = total ? ((checkedIn / total) * 100).toFixed(1) : "0.0";

  const totalPages = Math.max(1, Math.ceil(participantTotal / PAGE_SIZE));
  const fromRow = participantTotal === 0 ? 0 : participantPage * PAGE_SIZE + 1;
  const toRow = Math.min(participantTotal, (participantPage + 1) * PAGE_SIZE);

  const allSelected =
    participants.length > 0 && selectedParticipants.size === participants.length;

  const TABS: { key: TabKey; label: string; icon: React.ReactNode; short: string }[] = [
    { key: "participants", label: "Participants & Registration", short: "Attendees", icon: <Icon.IdCardTab /> },
    { key: "volunteers", label: "Gate Volunteers", short: "Volunteers", icon: <Icon.UsersTab /> },
    { key: "analytics", label: "Analytics & Logs", short: "Analytics", icon: <Icon.ChartTab /> },
  ];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: T.bg, fontFamily: FONT, color: T.text, paddingBottom: isMobile ? 80 : 0 }}>
      <div style={{
        backgroundColor: "#fff", borderBottom: `1px solid ${T.border}`,
        padding: isMobile ? "12px 16px" : "10px 24px",
        display: "flex", alignItems: "center", gap: isMobile ? 10 : 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: "#1D1D1F", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon.Qr style={{ color: T.blue }} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>PassPulse</span>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "2px 6px", borderRadius: 4, backgroundColor: "#E5E5EA", color: T.textSec }}>ADMIN</span>
            </div>
            <div style={{ fontSize: 11, color: T.textSec }}>HackSummit 2025</div>
          </div>
        </div>

        {!isMobile && (
          <>
            <span style={{ padding: "4px 10px", borderRadius: 20, backgroundColor: T.greenBg, fontSize: 11, fontWeight: 600, color: T.greenText }}>
              ● Gates Live • 12 Turnstiles
            </span>
            <div style={{ flex: 1, maxWidth: 480, marginLeft: 20 }}>
              <form onSubmit={handleSearch} style={{ display: "flex", alignItems: "center", gap: 8, backgroundColor: T.bg, borderRadius: 10, padding: "8px 14px" }}>
                <Icon.Search style={{ color: T.textTer }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search attendee, RFID, ticket ID…"
                  style={{ flex: 1, border: "none", outline: "none", fontSize: 13, color: T.text, background: "transparent", fontFamily: FONT }}
                />
              </form>
            </div>
          </>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: isMobile ? 8 : 16 }}>
          {!isMobile && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.textSec }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: T.blue }} />
              Sync: <strong style={{ color: T.text }}>12s ago</strong>
            </div>
          )}
          {!isMobile && (
            <button style={{ background: "none", border: "none", cursor: "pointer", color: T.text, padding: 4 }}>
              <Icon.Bell />
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", backgroundColor: "#1D1D1F", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>
                {initials(staff.name || "U")}
              </div>
              {!isMobile && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{staff.name}</div>
                  <div style={{ fontSize: 10, color: T.blue, fontWeight: 700, letterSpacing: 0.5 }}>LEAD ORGANIZER</div>
                </div>
              )}
            </div>
            <button
              onClick={handleLogout}
              title="Log out"
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: `1px solid ${T.border}`,
                backgroundColor: "#fff",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: FONT,
                color: T.red,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon.LogOut />
              {!isMobile && "Log out"}
            </button>
          </div>
        </div>
      </div>

      {!isMobile && (
        <div style={{ backgroundColor: "#fff", borderBottom: `1px solid ${T.border}`, padding: "0 24px", display: "flex", gap: 4 }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: "14px 16px", border: "none", background: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 600, fontFamily: FONT,
                  color: active ? T.text : T.textSec,
                  borderBottom: active ? `2px solid ${T.text}` : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: isMobile ? "16px" : "24px" }}>

        {activeTab === "participants" && (
          <>
            {!isMobile && (
              <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: 20, border: `1px solid ${T.border}`, boxShadow: T.shadow, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: "#EBF4FE", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon.Sync style={{ color: T.blue, width: 22, height: 22 }} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 17, fontWeight: 700 }}>Participants & Registration</span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "3px 8px", borderRadius: 6, backgroundColor: "#EBF4FE", color: "#0055B8" }}>● LIVE</span>
                    </div>
                    <div style={{ fontSize: 12, color: T.textSec, marginTop: 2 }}>Manage attendees, issue passes, and dispatch QR codes</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => refresh(true)} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: FONT, display: "flex", alignItems: "center", gap: 8, color: T.text }}>
                    <Icon.Sync /> Sync
                  </button>
                  <button onClick={handleExportCsv} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: FONT, display: "flex", alignItems: "center", gap: 8, color: T.text }}>
                    <Icon.Download /> Export
                  </button>
                </div>
              </div>
            )}

            {isMobile && (
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button onClick={() => { setAddTab("individual"); setShowAddParticipant(true); }} style={{ flex: 1.4, padding: 14, borderRadius: 14, backgroundColor: T.blue, color: "#fff", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Icon.Plus /> Add Attendee
                </button>
                <button onClick={() => { setAddTab("bulk"); setShowAddParticipant(true); }} style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: "#fff", color: T.text, border: `1px solid ${T.border}`, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Icon.Upload /> CSV
                </button>
              </div>
            )}

            {!isMobile && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                <StatCard label="TOTAL PARTICIPANTS" value={total.toLocaleString()} sub={`${((checkedIn + pending) / Math.max(1, total) * 100).toFixed(1)}% allocation`} icon={<Icon.Users style={{ color: T.blue }} />} accent={T.blue} />
                <StatCard label="CHECKED IN" value={checkedIn.toLocaleString()} sub={`${checkinRate}% entry rate`} icon={<Icon.Check style={{ color: T.green, width: 20, height: 20 }} />} accent={T.green} bar barPct={Number(checkinRate)} badge="● LIVE" />
                <StatCard label="PENDING ARRIVAL" value={pending.toLocaleString()} sub="Awaiting turnstile scan" icon={<Icon.Clock style={{ color: T.orange }} />} accent={T.orange} bar barPct={total ? (pending / total) * 100 : 0} />
                <StatCard label="INVALID SCANS" value={invalid.toLocaleString()} sub="Revoked / duplicates" icon={<Icon.Shield style={{ color: T.red }} />} accent={T.red} bar barPct={total ? (invalid / total) * 100 : 0} badge={invalid > 0 ? "ALERT" : undefined} />
              </div>
            )}

            {isMobile && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                <div style={{ backgroundColor: "#fff", borderRadius: 14, padding: 14, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
                  <div style={{ fontSize: 11, color: T.textSec, fontWeight: 600 }}>Registered</div>
                  <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{total.toLocaleString()}</div>
                </div>
                <div style={{ backgroundColor: "#fff", borderRadius: 14, padding: 14, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
                  <div style={{ fontSize: 11, color: T.textSec, fontWeight: 600 }}>Checked In</div>
                  <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{checkedIn.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: T.greenText, fontWeight: 600, marginTop: 2 }}>{checkinRate}% rate</div>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
              <form onSubmit={handleSearch} style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, backgroundColor: "#fff", border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 16px" }}>
                  <Icon.Search style={{ color: T.textTer }} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, college, email, or ticket ID…"
                    style={{ flex: 1, border: "none", outline: "none", fontSize: 14, color: T.text, background: "transparent", fontFamily: FONT }}
                  />
                </div>
              </form>
              {!isMobile && (
                <>
                  {selectedParticipants.size > 0 && (
                    <button
                      onClick={() => setBulkDeleteOpen(true)}
                      style={{
                        padding: "12px 18px", borderRadius: 12, border: "none",
                        backgroundColor: T.redBg, color: T.red,
                        cursor: "pointer", fontSize: 13, fontWeight: 700,
                        fontFamily: FONT, display: "flex", alignItems: "center", gap: 8,
                      }}
                    >
                      <Icon.Trash /> Delete {selectedParticipants.size} selected
                    </button>
                  )}
                  <button onClick={() => { setAddTab("bulk"); setShowAddParticipant(true); }} style={{ padding: "12px 18px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: FONT, color: T.text, display: "flex", alignItems: "center", gap: 8 }}>
                    <Icon.Upload /> Bulk Upload CSV
                  </button>
                  <button onClick={() => { setAddTab("individual"); setShowAddParticipant(true); }} style={{ padding: "12px 20px", borderRadius: 12, border: "none", backgroundColor: T.blue, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: FONT, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 4px 12px rgba(0,122,255,0.25)" }}>
                    <Icon.Plus /> Add Individual
                  </button>
                </>
              )}
            </div>

            <div style={{ backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#FAFAFB" }}>
                      <th style={{ padding: "12px 16px", textAlign: "left", width: 40, borderBottom: `1px solid ${T.border}` }}>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          style={{ cursor: "pointer" }}
                        />
                      </th>
                      {["PARTICIPANT", "COLLEGE / UNIVERSITY", "CONTACT EMAIL", "TICKET ID", "QR STATUS", "ACTIONS"].map((h, i) => (
                        <th key={i} style={{ padding: "12px 16px", textAlign: i === 5 ? "right" : "left", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: T.textTer, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {participants.map((p, idx) => (
                      <tr key={idx} style={{ borderBottom: idx < participants.length - 1 ? `1px solid ${T.borderSoft}` : "none" }}>
                        <td style={{ padding: "14px 16px", width: 40 }}>
                          <input
                            type="checkbox"
                            checked={selectedParticipants.has(p.id)}
                            onChange={() => toggleParticipantSelected(p.id)}
                            style={{ cursor: "pointer" }}
                          />
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ width: 38, height: 38, borderRadius: "50%", backgroundColor: avatarColor(p.name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                              {initials(p.name)}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{p.name}</div>
                          </div>
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{p.college || "—"}</div>
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: T.textSec }}>{p.email}</span>
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: T.textSec }}>
                            {p.ticket_id ? p.ticket_id.slice(0, 8) : "None"}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <StatusPill status={p.ticket_status} />
                        </td>
                        <td style={{ padding: "14px 16px", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: 6 }}>
                            {p.ticket_id && (
                              <>
                                <ActionIconButton title="Show QR" onClick={() => handleShowQr(p)} icon={<Icon.Qr style={{ width: 15, height: 15 }} />} />
                                {p.ticket_status !== "checked_in" && p.ticket_status !== "revoked" && (
                                  <>
                                    <ActionIconButton title="Revoke" tone="red" onClick={() => { setActionTicketId(p.ticket_id); setActionType("revoke"); }} icon={<Icon.X style={{ width: 14, height: 14 }} />} />
                                    <ActionIconButton title="Reissue" tone="blue" onClick={() => { setActionTicketId(p.ticket_id); setActionType("reissue"); }} icon={<Icon.Sync style={{ width: 14, height: 14 }} />} />
                                  </>
                                )}
                              </>
                            )}
                            <ActionIconButton
                              title="Delete participant"
                              tone="red"
                              onClick={() => setDeletingParticipant(p)}
                              icon={<Icon.Trash />}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {participants.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: 40, textAlign: "center", color: T.textSec, fontSize: 14 }}>
                          No participants found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: `1px solid ${T.border}`, backgroundColor: "#FAFAFB", flexWrap: "wrap", gap: 10 }}>
                <div style={{ fontSize: 12, color: T.textSec }}>
                  Showing <strong style={{ color: T.text }}>{fromRow}</strong>–<strong style={{ color: T.text }}>{toRow}</strong> of <strong style={{ color: T.text }}>{participantTotal}</strong>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => setParticipantPage((p) => Math.max(0, p - 1))} disabled={participantPage === 0} style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: participantPage === 0 ? "not-allowed" : "pointer", opacity: participantPage === 0 ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center", color: T.text }}>
                    <Icon.ChevronLeft />
                  </button>
                  <span style={{ fontSize: 13, fontWeight: 600, padding: "0 12px" }}>
                    Page {participantPage + 1} of {totalPages}
                  </span>
                  <button onClick={() => setParticipantPage((p) => Math.min(totalPages - 1, p + 1))} disabled={participantPage >= totalPages - 1} style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: participantPage >= totalPages - 1 ? "not-allowed" : "pointer", opacity: participantPage >= totalPages - 1 ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center", color: T.text }}>
                    <Icon.ChevronRight />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === "volunteers" && (
          <>
            <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: 20, border: `1px solid ${T.border}`, boxShadow: T.shadow, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: T.greenBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon.Users style={{ color: T.green, width: 22, height: 22 }} />
                </div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>Gate Volunteers</div>
                  <div style={{ fontSize: 12, color: T.textSec, marginTop: 2 }}>
                    {volunteers.filter((v) => v.role === "volunteer").length} volunteers •{" "}
                    {volunteers.filter((v) => v.role === "supervisor").length} supervisors •{" "}
                    {volunteers.filter((v) => v.role === "admin").length} admins
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => loadVolunteers(true)} disabled={volunteersLoading} style={{ padding: "12px 18px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: volunteersLoading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: FONT, color: T.text, display: "flex", alignItems: "center", gap: 8, opacity: volunteersLoading ? 0.6 : 1 }}>
                  <Icon.Sync /> {volunteersLoading ? "Loading…" : "Refresh"}
                </button>
                <button onClick={() => setShowAddStaff(true)} style={{ padding: "12px 20px", borderRadius: 12, border: "none", backgroundColor: T.blue, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: FONT, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 4px 12px rgba(0,122,255,0.25)" }}>
                  <Icon.Plus /> Add Volunteer / Staff
                </button>
              </div>
            </div>

            {volunteersError && (
              <div style={{ padding: "12px 16px", borderRadius: 12, backgroundColor: T.redBg, color: "#C62828", fontSize: 13, fontWeight: 600, marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Icon.Alert /> {volunteersError}
                </span>
                <button onClick={() => loadVolunteers(true)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", backgroundColor: T.red, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: FONT }}>
                  Retry
                </button>
              </div>
            )}

            <div style={{ backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
              {volunteersLoading && volunteers.length === 0 ? (
                <div style={{ padding: "60px 20px", textAlign: "center", color: T.textSec, fontSize: 14 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", border: `3px solid ${T.border}`, borderTopColor: T.blue, margin: "0 auto 14px", animation: "spin 0.8s linear infinite" }} />
                  Loading staff…
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#FAFAFB" }}>
                        {["STAFF MEMBER", "EMAIL", "ROLE", "STATUS", "ACTIONS"].map((h, i) => (
                          <th key={h} style={{ padding: "12px 16px", textAlign: i === 4 ? "right" : "left", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: T.textTer, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {volunteers.map((v, idx) => (
                        <tr key={idx} style={{ borderBottom: idx < volunteers.length - 1 ? `1px solid ${T.borderSoft}` : "none" }}>
                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <div style={{ width: 38, height: 38, borderRadius: "50%", backgroundColor: avatarColor(v.name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                                {initials(v.name)}
                              </div>
                              <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                                {v.name}
                                {v.id === staff?.id && (
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, backgroundColor: "#EBF4FE", color: "#0055B8" }}>YOU</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: "14px 16px" }}>
                            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: T.textSec }}>{v.email}</span>
                          </td>
                          <td style={{ padding: "14px 16px" }}><RolePill role={v.role} /></td>
                          <td style={{ padding: "14px 16px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: v.active ? T.greenText : T.textTer }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: v.active ? T.green : T.textTer }} />
                              {v.active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td style={{ padding: "14px 16px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: 6 }}>
                              <ActionIconButton title="Change role / status" tone="blue" onClick={() => openEditStaff(v)} icon={<Icon.Edit style={{ width: 14, height: 14 }} />} />
                              <ActionIconButton title={v.id === staff?.id ? "Can't delete yourself" : "Delete staff"} tone="red" onClick={() => v.id === staff?.id ? alert("You can't delete your own account.") : setDeletingStaff(v)} icon={<Icon.X style={{ width: 14, height: 14 }} />} />
                            </div>
                          </td>
                        </tr>
                      ))}
                      {volunteers.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ padding: 40, textAlign: "center", color: T.textSec, fontSize: 14 }}>
                            {volunteersError ? "Failed to load staff. Click Retry above." : "No staff members found."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "analytics" && (
          <>
            <div style={{ backgroundColor: "#fff", borderRadius: 16, padding: 20, border: `1px solid ${T.border}`, boxShadow: T.shadow, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: "#EBF4FE", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon.ChartTab style={{ color: T.blue, width: 22, height: 22 }} />
                </div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>Analytics & Logs</div>
                  <div style={{ fontSize: 12, color: T.textSec, marginTop: 2 }}>Real-time scan telemetry and event statistics</div>
                </div>
              </div>
              <button onClick={() => loadAnalytics(true)} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${T.border}`, backgroundColor: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: FONT, display: "flex", alignItems: "center", gap: 8, color: T.text }}>
                <Icon.Sync /> Refresh
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
              <StatCard label="TOTAL PARTICIPANTS" value={total.toLocaleString()} sub="Registered roster" icon={<Icon.Users style={{ color: T.blue }} />} accent={T.blue} />
              <StatCard label="CHECKED IN" value={checkedIn.toLocaleString()} sub={`${checkinRate}% entry rate`} icon={<Icon.Check style={{ color: T.green, width: 20, height: 20 }} />} accent={T.green} bar barPct={Number(checkinRate)} badge="● LIVE" />
              <StatCard label="PENDING" value={pending.toLocaleString()} sub="Awaiting turnstile scan" icon={<Icon.Clock style={{ color: T.orange }} />} accent={T.orange} bar barPct={total ? (pending / total) * 100 : 0} />
              <StatCard label="REVOKED" value={invalid.toLocaleString()} sub="Invalidated passes" icon={<Icon.Shield style={{ color: T.red }} />} accent={T.red} bar barPct={total ? (invalid / total) * 100 : 0} badge={invalid > 0 ? "ALERT" : undefined} />
            </div>

            <div style={{ backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Recent Scan Activity</div>
                  <div style={{ fontSize: 12, color: T.textSec, marginTop: 2 }}>Live gate telemetry</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.greenText, backgroundColor: T.greenBg, padding: "4px 10px", borderRadius: 20 }}>● Live</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#FAFAFB" }}>
                      {["TIME", "PARTICIPANT", "ACTION", "RESULT", "STAFF"].map((h) => (
                        <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: T.textTer, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scanLogs.map((log, idx) => (
                      <tr key={idx} style={{ borderBottom: idx < scanLogs.length - 1 ? `1px solid ${T.borderSoft}` : "none" }}>
                        <td style={{ padding: "12px 16px", fontSize: 12, color: T.textSec, fontFamily: "ui-monospace, monospace" }}>
                          {new Date(log.scanned_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600 }}>
                          {log.participant_name || log.detail?.name || `#${log.ticket_id?.slice(0, 8) || "—"}`}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 12, color: T.textSec, textTransform: "capitalize" }}>{log.action}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, backgroundColor: log.result === "success" ? T.greenBg : T.redBg, color: log.result === "success" ? T.greenText : "#C62828" }}>{log.result}</span>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 12, color: T.textSec }}>{log.staff_name || "—"}</td>
                      </tr>
                    ))}
                    {scanLogs.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ padding: 40, textAlign: "center", color: T.textSec, fontSize: 14 }}>
                          No scan activity yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {isMobile && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(255,255,255,0.98)", backdropFilter: "blur(20px)", borderTop: `1px solid ${T.border}`, display: "flex", padding: "8px 0 10px" }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{ flex: 1, border: "none", background: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: 4, fontFamily: FONT, color: active ? T.blue : T.textTer }}>
                {tab.icon}
                <span style={{ fontSize: 10, fontWeight: 600 }}>{tab.short}</span>
              </button>
            );
          })}
        </div>
      )}

      {showAddParticipant && (
        <Modal onClose={() => setShowAddParticipant(false)} width={addTab === "bulk" ? 940 : 500}>
          {addTab === "bulk" ? (
            <BulkCsvUploader
              onImported={() => { loadStats(true); loadParticipants(true); }}
              onCancel={() => setShowAddParticipant(false)}
              onClose={() => setShowAddParticipant(false)}
            />
          ) : (
            <>
              <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Add Participant</h3>
              <p style={{ fontSize: 13, color: T.textSec, marginBottom: 16 }}>Issue ticket + QR instantly.</p>

              <div style={{ display: "flex", gap: 4, padding: 4, backgroundColor: T.bg, borderRadius: 10, marginBottom: 18 }}>
                <button onClick={() => setAddTab("individual")} style={{ flex: 1, padding: "8px 12px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer", fontFamily: FONT, backgroundColor: addTab === "individual" ? "#fff" : "transparent", color: addTab === "individual" ? T.text : T.textSec, boxShadow: addTab === "individual" ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
                  Individual Participant
                </button>
                <button onClick={() => setAddTab("bulk")} style={{ flex: 1, padding: "8px 12px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer", fontFamily: FONT, backgroundColor: "transparent", color: T.textSec }}>
                  Bulk CSV Upload
                </button>
              </div>

              <form onSubmit={handleCreateParticipant}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textSec, letterSpacing: 0.5, marginBottom: 6 }}>FULL NAME *</label>
                <input type="text" value={newParticipant.name} onChange={(e) => setNewParticipant({ ...newParticipant, name: e.target.value })} placeholder="Elena Rostova" required style={inputStyle} />

                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textSec, letterSpacing: 0.5, marginBottom: 6 }}>EMAIL *</label>
                <input type="email" value={newParticipant.email} onChange={(e) => setNewParticipant({ ...newParticipant, email: e.target.value })} placeholder="elena@stanford.edu" required style={inputStyle} />

                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textSec, letterSpacing: 0.5, marginBottom: 6 }}>COLLEGE / INSTITUTION</label>
                <input type="text" value={newParticipant.college} onChange={(e) => setNewParticipant({ ...newParticipant, college: e.target.value })} placeholder="Stanford University" style={inputStyle} />

                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textSec, letterSpacing: 0.5, marginBottom: 6 }}>PHOTO URL</label>
                <input type="text" value={newParticipant.photo_url} onChange={(e) => setNewParticipant({ ...newParticipant, photo_url: e.target.value })} placeholder="https://…" style={inputStyle} />

                <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", backgroundColor: T.bg, borderRadius: 10, marginBottom: 16, cursor: "pointer" }}>
                  <input type="checkbox" checked={newParticipant.send_email} onChange={(e) => setNewParticipant({ ...newParticipant, send_email: e.target.checked })} style={{ width: 18, height: 18 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Also send QR by email</div>
                    <div style={{ fontSize: 11, color: T.textSec }}>Marks the ticket as emailed</div>
                  </div>
                </label>

                <div style={{ display: "flex", gap: 10 }}>
                  <button type="submit" disabled={creating} style={{ flex: 1, padding: 14, borderRadius: 12, border: "none", backgroundColor: T.blue, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT, opacity: creating ? 0.6 : 1 }}>
                    {creating ? "Creating…" : "Create + Issue QR"}
                  </button>
                  <button type="button" onClick={() => setShowAddParticipant(false)} style={{ padding: "14px 24px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, color: T.text }}>
                    Cancel
                  </button>
                </div>
              </form>
            </>
          )}
        </Modal>
      )}

      {showAddStaff && (
        <Modal onClose={() => setShowAddStaff(false)}>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Add Volunteer / Staff</h3>
          <p style={{ fontSize: 13, color: T.textSec, marginBottom: 16 }}>Create a login for a gate volunteer, supervisor, or another admin.</p>
          <form onSubmit={handleCreateStaff}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textSec, letterSpacing: 0.5, marginBottom: 6 }}>FULL NAME *</label>
            <input type="text" value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} placeholder="Jordan Lee" required style={inputStyle} />

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textSec, letterSpacing: 0.5, marginBottom: 6 }}>EMAIL *</label>
            <input type="email" value={newStaff.email} onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })} placeholder="jordan@passpulse.dev" required style={inputStyle} />

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textSec, letterSpacing: 0.5, marginBottom: 6 }}>PASSWORD *</label>
            <input type="password" value={newStaff.password} onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })} placeholder="min 6 characters" required minLength={6} style={inputStyle} />

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textSec, letterSpacing: 0.5, marginBottom: 6 }}>ROLE</label>
            <select value={newStaff.role} onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value as any })} style={inputStyle}>
              <option value="volunteer">Volunteer</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </select>

            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={creating} style={{ flex: 1, padding: 14, borderRadius: 12, border: "none", backgroundColor: T.blue, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>
                {creating ? "Creating…" : "Create Staff"}
              </button>
              <button type="button" onClick={() => setShowAddStaff(false)} style={{ padding: "14px 24px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, color: T.text }}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editingStaff && (
        <Modal onClose={() => setEditingStaff(null)}>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Edit Staff Member</h3>
          <p style={{ fontSize: 13, color: T.textSec, marginBottom: 16 }}>
            {editingStaff.name} • {editingStaff.email}
          </p>

          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textSec, letterSpacing: 0.5, marginBottom: 6 }}>ROLE</label>
          <select value={editRole} onChange={(e) => setEditRole(e.target.value as any)} style={inputStyle}>
            <option value="volunteer">Volunteer</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>

          <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", backgroundColor: T.bg, borderRadius: 10, marginBottom: 16, cursor: "pointer" }}>
            <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} style={{ width: 18, height: 18 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Active</div>
              <div style={{ fontSize: 11, color: T.textSec }}>Inactive staff can't log in</div>
            </div>
          </label>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleUpdateStaff} disabled={staffActionBusy} style={{ flex: 1, padding: 14, borderRadius: 12, border: "none", backgroundColor: T.blue, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT, opacity: staffActionBusy ? 0.6 : 1 }}>
              {staffActionBusy ? "Saving…" : "Save Changes"}
            </button>
            <button onClick={() => setEditingStaff(null)} style={{ padding: "14px 24px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, color: T.text }}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {deletingStaff && (
        <Modal onClose={() => setDeletingStaff(null)} width={440}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", backgroundColor: T.redBg, color: T.red, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 14 }}>
            <Icon.Alert />
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Delete {deletingStaff.name}?</h3>
          <p style={{ fontSize: 13, color: T.textSec, marginBottom: 20 }}>
            This removes <strong>{deletingStaff.email}</strong> permanently.
            Their scan history will be preserved but anonymized.
          </p>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleDeleteStaff} disabled={staffActionBusy} style={{ flex: 1, padding: 14, borderRadius: 12, border: "none", backgroundColor: T.red, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT, opacity: staffActionBusy ? 0.6 : 1 }}>
              {staffActionBusy ? "Deleting…" : "Yes, Delete"}
            </button>
            <button onClick={() => setDeletingStaff(null)} style={{ padding: "14px 24px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, color: T.text }}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {deletingParticipant && (
        <Modal onClose={() => setDeletingParticipant(null)} width={440}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", backgroundColor: T.redBg, color: T.red, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 14 }}>
            <Icon.Alert />
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
            Delete {deletingParticipant.name}?
          </h3>
          <p style={{ fontSize: 13, color: T.textSec, marginBottom: 20, lineHeight: 1.5 }}>
            This removes the participant <strong>{deletingParticipant.email}</strong> and
            all their tickets from the database. Their QR pass will stop working.
            Scan log entries are kept but detached.
          </p>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={handleDeleteParticipant}
              disabled={deleteBusy}
              style={{ flex: 1, padding: 14, borderRadius: 12, border: "none", backgroundColor: T.red, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT, opacity: deleteBusy ? 0.6 : 1 }}
            >
              {deleteBusy ? "Deleting…" : "Yes, Delete"}
            </button>
            <button
              onClick={() => setDeletingParticipant(null)}
              style={{ padding: "14px 24px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, color: T.text }}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {bulkDeleteOpen && (
        <Modal onClose={() => setBulkDeleteOpen(false)} width={440}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", backgroundColor: T.redBg, color: T.red, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 14 }}>
            <Icon.Alert />
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
            Delete {selectedParticipants.size} participant{selectedParticipants.size === 1 ? "" : "s"}?
          </h3>
          <p style={{ fontSize: 13, color: T.textSec, marginBottom: 20, lineHeight: 1.5 }}>
            This removes all selected participants and their tickets from the
            database. This action cannot be undone.
          </p>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={handleBulkDelete}
              disabled={deleteBusy}
              style={{ flex: 1, padding: 14, borderRadius: 12, border: "none", backgroundColor: T.red, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT, opacity: deleteBusy ? 0.6 : 1 }}
            >
              {deleteBusy ? "Deleting…" : `Delete ${selectedParticipants.size}`}
            </button>
            <button
              onClick={() => setBulkDeleteOpen(false)}
              style={{ padding: "14px 24px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, color: T.text }}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {createdTicket && (
        <Modal onClose={() => setCreatedTicket(null)} width={480}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", backgroundColor: T.greenBg, color: T.green, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 26, marginBottom: 10 }}>✓</div>
            <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Ticket Issued</h3>
            <p style={{ fontSize: 13, color: T.textSec }}>
              {createdTicket.participant?.name}
              {createdTicket.email_sent && <span> • email queued</span>}
            </p>
          </div>

          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <div style={{ padding: 14, borderRadius: 16, backgroundColor: "#fff", border: `1px solid ${T.border}` }}>
              <img src={`${API_BASE}${createdTicket.qr_png_url}`} alt="Ticket QR" width={220} height={220} style={{ display: "block", imageRendering: "pixelated" }} />
            </div>
          </div>

          <CopyBlock label="QR Token (paste into scanner)" value={createdTicket.token || "—"} onCopy={() => copyToClipboard(createdTicket.token || "", "Token")} highlight />
          <CopyBlock label="Public URL" value={createdTicket.qr_url || "—"} onCopy={() => copyToClipboard(createdTicket.qr_url || "", "URL")} />
          <CopyBlock label="Ticket ID" value={createdTicket.ticket?.id || "—"} onCopy={() => copyToClipboard(createdTicket.ticket?.id || "", "Ticket ID")} subtle />

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <a href={`${API_BASE}${createdTicket.qr_png_url}`} download={`pass-${(createdTicket.participant?.name || "ticket").replace(/\s+/g, "-").toLowerCase()}.png`} style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: T.blue, color: "#fff", textDecoration: "none", textAlign: "center", fontSize: 14, fontWeight: 700, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Icon.Download /> Download PNG
            </a>
            <button onClick={() => setCreatedTicket(null)} style={{ padding: "14px 24px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, color: T.text }}>
              Done
            </button>
          </div>
        </Modal>
      )}

      {actionTicketId && (
        <Modal onClose={() => { setActionTicketId(null); setActionType(null); setActionReason(""); }}>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, textTransform: "capitalize" }}>{actionType} Ticket</h3>
          <p style={{ fontSize: 13, color: T.textSec, marginBottom: 16 }}>Audit reason required:</p>
          <input type="text" value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="e.g. Lost device, damaged QR" style={inputStyle} />
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleTicketAction} style={{ flex: 1, padding: 14, borderRadius: 12, border: "none", backgroundColor: actionType === "revoke" ? T.red : T.blue, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT, textTransform: "capitalize" }}>
              Confirm {actionType}
            </button>
            <button onClick={() => { setActionTicketId(null); setActionType(null); setActionReason(""); }} style={{ padding: "14px 24px", borderRadius: 12, border: `1px solid ${T.border}`, backgroundColor: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT, color: T.text }}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}