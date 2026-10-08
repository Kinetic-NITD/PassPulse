"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface TicketInfo {
  participant_name: string;
  email_masked: string;
  college: string | null;
  photo_url: string | null;
  event_name: string;
  status: "issued" | "pending" | "checked_in";
  checked_in_at: string | null;
}

export default function PublicTicketPage({
  params,
}: {
  params: { token: string };
}) {
  const { token } = params;

  const [info, setInfo] = useState<TicketInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The QR encodes the full public URL (scanner extracts the token from it)
  const publicBaseUrl =
    process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3000");
  const qrUrl = `${publicBaseUrl}/t/${token}`;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/tickets/by-token/${encodeURIComponent(token)}`
        );
        const body = await res.json();

        if (!res.ok) {
          const msg =
            body?.detail?.message ||
            body?.detail ||
            "This pass is not valid.";
          throw new Error(msg);
        }

        if (!cancelled) setInfo(body);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Unable to load pass.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Shared outer shell — same for loading, error, success
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0B0F19",
        color: "#FFFFFF",
        padding: "20px",
        textAlign: "center",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.05)",
          borderRadius: "24px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          padding: "32px 24px",
          maxWidth: "400px",
          width: "100%",
          boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
        }}
      >
        {children}
      </div>
    </div>
  );

  if (loading) {
    return (
      <Shell>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🎟️</div>
        <p style={{ color: "#8E8E93", fontSize: 14 }}>Loading your pass…</p>
      </Shell>
    );
  }

  if (error || !info) {
    return (
      <Shell>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "#FF3B30" }}>
          Pass Not Valid
        </h1>
        <p style={{ fontSize: 14, color: "#8E8E93", lineHeight: 1.5 }}>
          {error || "This QR code is not a valid PassPulse pass."}
        </p>
        <p style={{ fontSize: 12, color: "#636366", marginTop: 16 }}>
          Contact the event organizers if you believe this is an error.
        </p>
      </Shell>
    );
  }

  const alreadyCheckedIn = info.status === "checked_in";

  return (
    <Shell>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          backgroundColor: "#161B22",
          border: "1px solid rgba(255,255,255,0.1)",
          margin: "0 auto 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
        }}
      >
        🎟️
      </div>

      <h1
        style={{
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 6,
          color: "#007AFF",
        }}
      >
        Event Pass
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "#8E8E93",
          lineHeight: 1.5,
          marginBottom: 20,
        }}
      >
        {alreadyCheckedIn
          ? "You've already checked in for this event."
          : "Show this QR code at the check-in gate."}
      </p>

      {/* Participant identity block */}
      <div
        style={{
          backgroundColor: "rgba(255,255,255,0.04)",
          borderRadius: 16,
          padding: "16px 16px",
          marginBottom: 20,
          textAlign: "left",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              backgroundColor: "#1D1D1F",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 700,
              color: "#007AFF",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            {info.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={info.photo_url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              info.participant_name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#FFFFFF",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {info.participant_name}
            </div>
            <div style={{ fontSize: 12, color: "#8E8E93", marginTop: 2 }}>
              {info.college || info.email_masked}
            </div>
          </div>
        </div>

        <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.06)", margin: "8px 0" }} />

        <Row label="Event" value={info.event_name} />
      </div>

      {/* The QR — generated client-side, zero server load */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          padding: 16,
          borderRadius: 16,
          display: "inline-block",
          marginBottom: 20,
          position: "relative",
          opacity: alreadyCheckedIn ? 0.35 : 1,
        }}
      >
        <QRCodeSVG
          value={qrUrl}
          size={200}
          level="M"
          bgColor="#FFFFFF"
          fgColor="#1D1D1F"
        />
        {alreadyCheckedIn && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                backgroundColor: "#34C759",
                color: "#FFFFFF",
                padding: "6px 14px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0.5,
                transform: "rotate(-12deg)",
              }}
            >
              ✓ CHECKED IN
            </div>
          </div>
        )}
      </div>

      {/* Single-use warning */}
      <div
        style={{
          backgroundColor: "rgba(255,149,0,0.1)",
          border: "1px solid rgba(255,149,0,0.25)",
          borderRadius: 12,
          padding: "10px 12px",
          fontSize: 12,
          color: "#FF9500",
          lineHeight: 1.5,
          textAlign: "left",
          marginBottom: 12,
        }}
      >
        <strong>Single-use pass.</strong> Do not share this QR with anyone.
        It will only work once at the check-in gate.
      </div>

      {/* Reissue / multi-day instruction */}
      <div
        style={{
          backgroundColor: "rgba(0,122,255,0.1)",
          border: "1px solid rgba(0,122,255,0.25)",
          borderRadius: 12,
          padding: "10px 12px",
          fontSize: 12,
          color: "#5AC8FA",
          lineHeight: 1.5,
          textAlign: "left",
          marginBottom: 16,
        }}
      >
        <strong>Checking out of the institute?</strong> If you check out and
        will need to check in again on another day, inform the event volunteers
        or co-ordinators so they can reissue your pass.
      </div>

      <div style={{ fontSize: 11, color: "#636366" }}>
        Single-Use Security - SUS
      </div>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "4px 0",
        fontSize: 12,
      }}
    >
      <span style={{ color: "#8E8E93" }}>{label}</span>
      <span style={{ color: "#FFFFFF", fontWeight: 600, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}