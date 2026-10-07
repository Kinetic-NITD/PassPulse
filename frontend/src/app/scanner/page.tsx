"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";

import { api, getStaff, removeToken } from "@/lib/api";
import { extractToken, verifyToken, looksLikeUuid } from "@/lib/token";

interface ParticipantCardData {
  ticket: any;
  participant: { name: string; email: string; college?: string; photo_url?: string };
  event: { id: string; name: string };
  lease_expiry: string;
}

interface ScanErrorData {
  title: string;
  reason: string;
  diagnostic: string;
  message?: string;
  details?: any;
  token?: string;
}

export default function ScannerPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<any>(null);
  const [publicKeys, setPublicKeys] = useState<Record<string, string>>({});

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ParticipantCardData | null>(null);
  const [scanError, setScanError] = useState<ScanErrorData | null>(null);
  const [checkinSuccess, setCheckinSuccess] = useState<any | null>(null);

  const [captureStatus, setCaptureStatus] = useState<string>("");
  const [scanning, setScanning] = useState(false);

  const [idCardNo, setIdCardNo] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [showManualModal, setShowManualModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearchModal, setShowSearchModal] = useState(false);

  const [secondsLeft, setSecondsLeft] = useState<number>(60);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [shiftCount, setShiftCount] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanLockedRef = useRef(false);
  const handleRef = useRef<(text: string) => void>(() => { });
  const idInputRef = useRef<HTMLInputElement | null>(null);

  // ─── Ref callback: reattach live stream every time the <video> mounts ───
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      try {
        el.srcObject = streamRef.current;
        el.muted = true;
        el.setAttribute("playsinline", "true");
        const p = el.play();
        if (p && typeof p.catch === "function") p.catch(() => { });
      } catch {
        /* ignore */
      }
    }
  }, []);

  // ─── Auth bootstrap ─────────────────────────────────────────────
  useEffect(() => {
    const currentStaff = getStaff();
    if (!currentStaff) {
      router.replace("/login");
      return;
    }
    setStaff(currentStaff);
    api.getPublicKeys().then(setPublicKeys).catch(console.error);
    loadRecentLogs();
  }, [router]);

  const loadRecentLogs = async () => {
    try {
      const data = await api.getScanLog(5);
      setRecentLogs(data.logs || []);
      const count = data.logs.filter(
        (l: any) => l.action === "confirm" && l.result === "success"
      ).length;
      setShiftCount(count);
    } catch { }
  };

  // ─── Camera: acquire stream on mount ─────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (streamRef.current && streamRef.current.active) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute("playsinline", "true");
          video.muted = true;
          try {
            await video.play();
          } catch (playErr: any) {
            if (playErr?.name !== "AbortError") throw playErr;
          }
        }

        if (!cancelled) {
          setCameraActive(true);
          setCameraError(null);
        }
      } catch (err: any) {
        if (cancelled) return;
        console.warn("Camera start failed:", err);
        setCameraActive(false);
        const n = err?.name;
        setCameraError(
          n === "NotAllowedError"
            ? "Camera permission denied. Allow access in the URL bar, or paste the token manually."
            : n === "NotFoundError"
              ? "No camera found on this device."
              : err?.message || "Camera unavailable. Paste the token manually."
        );
      }
    };

    run();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setCameraActive(false);
    };
  }, []);

  const restartCamera = async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch { }
    }
    setCameraActive(false);
    setCameraError(null);

    await new Promise((r) => setTimeout(r, 300));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.muted = true;
        try {
          await video.play();
        } catch { }
      }
      setCameraActive(true);
    } catch (err: any) {
      setCameraError(err?.message || "Camera unavailable");
    }
  };

  // ─── Single-shot capture ─────────────────────────────────────────
  const captureAndDecode = useCallback(async () => {
    if (scanLockedRef.current || scanning) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      setCaptureStatus("Camera not ready");
      return;
    }
    if (video.readyState < 2 || !video.videoWidth) {
      setCaptureStatus("Camera still warming up — try again");
      return;
    }

    setScanning(true);
    setCaptureStatus("Capturing…");

    try {
      const w = video.videoWidth;
      const h = video.videoHeight;

      canvas.width = w;
      canvas.height = h;
      // willReadFrequently only matters on the first getContext call
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setCaptureStatus("Canvas error");
        setScanning(false);
        return;
      }

      // Pass 1 — full frame
      ctx.drawImage(video, 0, 0, w, h);
      let imageData = ctx.getImageData(0, 0, w, h);
      let code = jsQR(imageData.data, w, h, {
        inversionAttempts: "attemptBoth",
      });

      // Pass 2 — full frame, don't invert
      if (!code) {
        code = jsQR(imageData.data, w, h, { inversionAttempts: "dontInvert" });
      }

      // Pass 3 — center 60% crop
      if (!code) {
        const cw = Math.floor(w * 0.6);
        const ch = Math.floor(h * 0.6);
        const cx = Math.floor((w - cw) / 2);
        const cy = Math.floor((h - ch) / 2);
        canvas.width = cw;
        canvas.height = ch;
        ctx.drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);
        imageData = ctx.getImageData(0, 0, cw, ch);
        code = jsQR(imageData.data, cw, ch, {
          inversionAttempts: "attemptBoth",
        });
      }

      // Pass 4 — center 35% crop
      if (!code) {
        const cw = Math.floor(w * 0.35);
        const ch = Math.floor(h * 0.35);
        const cx = Math.floor((w - cw) / 2);
        const cy = Math.floor((h - ch) / 2);
        canvas.width = cw;
        canvas.height = ch;
        ctx.drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);
        imageData = ctx.getImageData(0, 0, cw, ch);
        code = jsQR(imageData.data, cw, ch, {
          inversionAttempts: "attemptBoth",
        });
      }

      if (code && code.data) {
        setCaptureStatus("QR detected — verifying…");
        scanLockedRef.current = true;
        setScanning(false);
        await handleRef.current(code.data);
        return;
      }

      setCaptureStatus(
        "No QR found — move the QR closer (fills most of the frame) and tap again"
      );
      setScanning(false);
      setTimeout(() => setCaptureStatus(""), 3500);
    } catch (err: any) {
      console.warn("Capture failed:", err);
      setCaptureStatus("Capture error — try again");
      setScanning(false);
      setTimeout(() => setCaptureStatus(""), 2500);
    }
  }, [scanning]);

  useEffect(() => {
    handleRef.current = handleRawScan;
  });

  useEffect(() => {
    if (scanResult && idInputRef.current) idInputRef.current.focus();
  }, [scanResult]);

  useEffect(() => {
    if (!scanResult?.lease_expiry) return;
    const interval = setInterval(() => {
      const expiry = new Date(scanResult.lease_expiry).getTime();
      const diff = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      setSecondsLeft(diff);
      if (diff <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [scanResult]);

  // ─── Decoded QR or pasted string ────────────────────────────────
  const handleRawScan = async (scannedText: string) => {
    // Detect obvious "wrong thing pasted" cases first
    const raw = (scannedText || "").trim();
    const stripped = raw.replace(/^["'`\s]+|["'`\s]+$/g, "");

    if (looksLikeUuid(stripped)) {
      setScanError({
        title: "That's the Ticket ID, not the QR token",
        reason: "wrong_input",
        diagnostic: "ERR_PASTED_TICKET_ID",
        message:
          "You pasted the ticket UUID. Paste the `qr_url` or `qr_token` column from the CSV export instead (it starts with http://... and contains /t/).",
        token: stripped.slice(0, 16) + "…",
      });
      setCaptureStatus("");
      return;
    }

    const token = extractToken(raw);

    if (!token || token.length < 40) {
      setScanError({
        title: "That doesn't look like a QR token",
        reason: "too_short",
        diagnostic: "ERR_TOKEN_TOO_SHORT",
        message: `Extracted only ${token.length} characters from what you pasted. A valid token is ~110 characters. Paste the full URL from the CSV's qr_url column.`,
        token: token.slice(0, 24) + (token.length > 24 ? "…" : ""),
      });
      setCaptureStatus("");
      return;
    }

    const verification = await verifyToken(token, publicKeys);

    if (!verification.valid) {
      setScanError({
        title:
          verification.error === "unknown_key"
            ? "Unknown Signing Key"
            : verification.error === "bad_signature"
              ? "Invalid Ticket Signature"
              : "Malformed QR Code",
        reason: verification.error || "invalid",
        diagnostic:
          verification.error === "bad_signature"
            ? "ERR_CRYPTO_SIGNATURE_MISMATCH"
            : verification.error === "unknown_key"
              ? "ERR_UNKNOWN_KEY_ID"
              : "ERR_TOKEN_MALFORMED",
        message:
          verification.errorMessage ||
          "This QR code is not a valid PassPulse ticket.",
        token: token.slice(0, 16) + "…",
      });
      setCaptureStatus("");
      return;
    }

    try {
      const res = await api.scanTicket(token);
      setScanResult(res);
      setIdCardNo("");
      setScanError(null);
      setCheckinSuccess(null);
      setCaptureStatus("");
    } catch (err: any) {
      const detail = err.detail || {};
      const reason = detail.reason || "unknown_error";
      let title = "Scan Failed";
      if (reason === "already_checked_in") title = "Ticket Already Checked In";
      else if (reason === "pending_other") title = "Lease Held By Another Volunteer";
      else if (reason === "revoked") title = "Ticket Revoked";
      else if (reason === "not_found") title = "Ticket Not Found";

      setScanError({
        title,
        reason,
        diagnostic: `ERR_${reason.toUpperCase()}`,
        details: detail.details,
        message: detail.message,
        token: token.slice(0, 16) + "…",
      });
      setCaptureStatus("");
    }
  };

  const handleConfirm = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!scanResult?.ticket?.id) return;
    if (!idCardNo.trim()) {
      alert("Please enter or scan an Event ID Card Number");
      idInputRef.current?.focus();
      return;
    }
    try {
      const res = await api.confirmTicket(scanResult.ticket.id, idCardNo.trim());
      setCheckinSuccess({
        participant: scanResult.participant,
        id_card_no: idCardNo.trim(),
        ticket: res.ticket,
      });
      setScanResult(null);
      loadRecentLogs();
    } catch (err: any) {
      const detail = err.detail || {};
      const reason = detail.reason || "confirm_failed";
      if (reason === "id_card_taken") {
        alert(`ID Card "${idCardNo}" is already assigned to another attendee.`);
        idInputRef.current?.select();
        idInputRef.current?.focus();
      } else {
        setScanError({
          title: "Confirmation Failed",
          reason,
          diagnostic: `ERR_${reason.toUpperCase()}`,
          details: detail.details,
          message: detail.message,
        });
        setScanResult(null);
      }
    }
  };

  const handleCancel = async () => {
    if (scanResult?.ticket?.id) {
      try {
        await api.cancelTicket(scanResult.ticket.id);
      } catch { }
    }
    resetScanner();
  };

  const resetScanner = () => {
    scanLockedRef.current = false;
    setScanResult(null);
    setScanError(null);
    setCheckinSuccess(null);
    setIdCardNo("");
    setCaptureStatus("");
    setScanning(false);
  };

  const handleLogout = () => {
    removeToken();
    router.push("/login");
  };

  return (
    <div
      style={{
        maxWidth: "480px",
        margin: "0 auto",
        minHeight: "100vh",
        backgroundColor: "#F2F4F7",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "14px 16px",
          backgroundColor: "#FFFFFF",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              backgroundColor: "#161B22",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#007AFF"
              strokeWidth="2.5"
            >
              <path d="M3 7V5a2 2 0 0 1 2-2h2"></path>
              <path d="M17 3h2a2 2 0 0 1 2 2v2"></path>
              <path d="M21 17v2a2 2 0 0 1-2 2h-2"></path>
              <path d="M7 21H5a2 2 0 0 1-2-2v-2"></path>
            </svg>
          </div>
          <div>
            <span
              style={{ fontSize: "16px", fontWeight: "700", color: "#1C1C1E" }}
            >
              PassPulse
            </span>
            <span
              style={{
                marginLeft: "6px",
                fontSize: "12px",
                color: cameraActive ? "#34C759" : "#FF9500",
                fontWeight: "600",
              }}
            >
              • {cameraActive ? "Camera On" : "Offline"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => setShowSearchModal(true)}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              backgroundColor: "#F2F4F7",
            }}
          >
            🔍
          </button>
          <button
            onClick={handleLogout}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              backgroundColor: "#007AFF",
              color: "#fff",
              fontSize: "13px",
              fontWeight: "600",
            }}
          >
            {staff?.name?.slice(0, 1) || "U"}
          </button>
        </div>
      </header>

      <main
        style={{
          padding: "16px",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {/* SUCCESS */}
        {checkinSuccess && (
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "20px",
              padding: "20px",
              border: "1px solid rgba(52,199,89,0.3)",
              boxShadow: "0 8px 24px rgba(52,199,89,0.15)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  backgroundColor: "#34C759",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                }}
              >
                ✓
              </div>
              <div>
                <div style={{ fontSize: "18px", fontWeight: "700" }}>
                  Checked In!
                </div>
                <div style={{ fontSize: "14px", color: "#8E8E93" }}>
                  {checkinSuccess.participant.name}
                </div>
              </div>
            </div>
            <div
              style={{
                backgroundColor: "#F2F4F7",
                padding: "12px 14px",
                borderRadius: "12px",
                fontSize: "14px",
                marginBottom: "16px",
              }}
            >
              <div>
                <strong>Badge:</strong> {checkinSuccess.id_card_no}
              </div>
            </div>
            <button
              onClick={resetScanner}
              className="btn-primary"
              style={{ padding: "14px", width: "100%" }}
            >
              Scan Next
            </button>
          </div>
        )}

        {/* PARTICIPANT CARD */}
        {scanResult && !checkinSuccess && (
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "22px",
              overflow: "hidden",
              boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
            }}
          >
            <div
              style={{
                backgroundColor: "#E8F9EE",
                padding: "10px 16px",
                display: "flex",
                justifyContent: "space-between",
                borderBottom: "1px solid rgba(52,199,89,0.2)",
              }}
            >
              <span
                style={{ fontSize: "13px", fontWeight: "700", color: "#1B7A37" }}
              >
                ● VALID TICKET
              </span>
              <span style={{ fontSize: "12px", color: "#8E8E93" }}>
                Lease: {secondsLeft}s
              </span>
            </div>
            <div style={{ padding: "20px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  marginBottom: "18px",
                }}
              >
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    backgroundColor: "#E5E5EA",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "24px",
                    fontWeight: "600",
                    color: "#636366",
                  }}
                >
                  {scanResult.participant.photo_url ? (
                    <img
                      src={scanResult.participant.photo_url}
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    scanResult.participant.name.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div>
                  <h2 style={{ fontSize: "20px", fontWeight: "700" }}>
                    {scanResult.participant.name}
                  </h2>
                  <div style={{ fontSize: "14px", color: "#636366" }}>
                    {scanResult.participant.college || "Participant"}
                  </div>
                  <div style={{ fontSize: "12px", color: "#8E8E93" }}>
                    {scanResult.event.name}
                  </div>
                </div>
              </div>
              <div
                style={{
                  backgroundColor: "#F9FAFC",
                  borderRadius: "14px",
                  padding: "12px 14px",
                  marginBottom: "20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "14px",
                  }}
                >
                  <span style={{ color: "#8E8E93" }}>Email:</span>
                  <span>{scanResult.participant.email}</span>
                </div>
              </div>
              <form onSubmit={handleConfirm}>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: "700",
                    marginBottom: "6px",
                  }}
                >
                  SCAN OR ENTER ID CARD NO *
                </label>
                <input
                  ref={idInputRef}
                  type="text"
                  value={idCardNo}
                  onChange={(e) => setIdCardNo(e.target.value)}
                  placeholder="e.g. CARD-2025-001"
                  required
                  style={{
                    width: "100%",
                    padding: "14px 16px",
                    borderRadius: "12px",
                    border: "2px solid #007AFF",
                    fontSize: "18px",
                    fontWeight: "600",
                    marginBottom: "16px",
                    outline: "none",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <button type="submit" className="btn-success">
                    ✓ VERIFY & CHECK-IN
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="btn-secondary"
                  >
                    ✕ Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ERROR */}
        {scanError && (
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "22px",
              overflow: "hidden",
              boxShadow: "0 12px 32px rgba(255,59,48,0.12)",
            }}
          >
            <div
              style={{
                backgroundColor: "#FF3B30",
                color: "#FFFFFF",
                padding: "12px 16px",
                display: "flex",
                justifyContent: "space-between",
                fontWeight: "700",
                fontSize: "13px",
              }}
            >
              <span>🛡️ VERIFICATION REJECTED</span>
              <button
                onClick={resetScanner}
                style={{ color: "#fff", fontSize: "18px" }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "20px" }}>
              <h2
                style={{
                  fontSize: "22px",
                  fontWeight: "700",
                  marginBottom: "8px",
                }}
              >
                {scanError.title}
              </h2>
              <p
                style={{
                  fontSize: "14px",
                  color: "#636366",
                  marginBottom: "16px",
                }}
              >
                {scanError.message || "The scanned QR could not be verified."}
              </p>
              <div
                style={{
                  backgroundColor: "#FEECEB",
                  borderRadius: "12px",
                  padding: "14px",
                  marginBottom: "20px",
                }}
              >
                <div style={{ fontSize: "12px", color: "#8E8E93" }}>
                  Diagnostic:
                </div>
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: "14px",
                    fontWeight: "700",
                    color: "#C62828",
                  }}
                >
                  {scanError.diagnostic}
                </div>
              </div>
              <button
                onClick={resetScanner}
                className="btn-danger"
                style={{ width: "100%", padding: "14px", borderRadius: "12px" }}
              >
                🔄 Dismiss
              </button>
            </div>
          </div>
        )}

        {/* CAMERA VIEWFINDER */}
        {!scanResult && !scanError && !checkinSuccess && (
          <>
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "360px",
                backgroundColor: "#000",
                borderRadius: "24px",
                overflow: "hidden",
              }}
            >
              {/* ref callback re-attaches the stream when this remounts */}
              <video
                ref={attachVideo}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                muted
                playsInline
                autoPlay
              />
              <canvas ref={canvasRef} style={{ display: "none" }} />

              <div
                style={{
                  position: "absolute",
                  inset: "40px",
                  border: "2px solid rgba(0,122,255,0.7)",
                  borderRadius: "16px",
                  pointerEvents: "none",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  padding: "8px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: "700",
                      color: "#fff",
                      backgroundColor: "rgba(0,0,0,0.6)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    ● Turnstile 02
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: "700",
                      color: "#fff",
                      backgroundColor: "rgba(0,0,0,0.6)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    {cameraActive ? "Ready" : "Camera Off"}
                  </span>
                </div>
                <div
                  style={{
                    textAlign: "center",
                    fontSize: "12px",
                    color: "rgba(255,255,255,0.95)",
                    textShadow: "0 1px 4px rgba(0,0,0,0.9)",
                  }}
                >
                  Align QR inside the frame, then tap Capture
                </div>
              </div>

              {cameraError && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: "rgba(0,0,0,0.88)",
                    color: "#fff",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: "28px", marginBottom: "8px" }}>📷</div>
                  <div
                    style={{
                      fontSize: "14px",
                      marginBottom: "16px",
                      maxWidth: "320px",
                    }}
                  >
                    {cameraError}
                  </div>
                  <button
                    onClick={restartCamera}
                    className="btn-secondary"
                    style={{ padding: "10px 18px", marginBottom: "10px" }}
                  >
                    🔄 Retry Camera
                  </button>
                  <button
                    onClick={() => setShowManualModal(true)}
                    className="btn-primary"
                    style={{ padding: "10px 18px" }}
                  >
                    Paste Token
                  </button>
                </div>
              )}
            </div>

            {captureStatus && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "10px",
                  backgroundColor: captureStatus.startsWith("No QR")
                    ? "#FFF4E5"
                    : captureStatus.startsWith("QR detected")
                      ? "#E8F9EE"
                      : "#EBF4FE",
                  color: captureStatus.startsWith("No QR")
                    ? "#8A5B00"
                    : captureStatus.startsWith("QR detected")
                      ? "#1B7A37"
                      : "#0055B8",
                  fontSize: "13px",
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                {captureStatus}
              </div>
            )}

            <button
              onClick={captureAndDecode}
              disabled={!cameraActive || scanning}
              className="btn-primary"
              style={{
                padding: "20px",
                fontSize: "18px",
                fontWeight: "700",
                borderRadius: "16px",
                opacity: !cameraActive || scanning ? 0.5 : 1,
                boxShadow: "0 8px 20px rgba(0,122,255,0.25)",
              }}
            >
              {scanning ? "⏳ Scanning…" : "📸 Capture & Scan QR"}
            </button>

            <button
              onClick={() => setShowManualModal(true)}
              className="btn-secondary"
              style={{ padding: "12px", fontSize: "14px" }}
            >
              📋 Paste Token Manually
            </button>

            {/* Scans this session */}
            <div className="card">
              <div style={{ fontSize: "12px", color: "#8E8E93", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Scans this session
              </div>
              <div style={{ fontSize: "32px", fontWeight: 800, color: "#1C1C1E", marginTop: 4 }}>
                {shiftCount}
              </div>
            </div>

            <div className="card">
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: "700",
                  color: "#8E8E93",
                  textTransform: "uppercase",
                  marginBottom: "12px",
                }}
              >
                Gate Activity
              </div>
              {recentLogs.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "20px 0",
                    color: "#8E8E93",
                    fontSize: "14px",
                  }}
                >
                  No activity yet
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  {recentLogs.slice(0, 4).map((log, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "8px 0",
                        borderBottom: "1px solid rgba(0,0,0,0.04)",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: "600" }}>
                          {log.participant_name ||
                            log.detail?.name ||
                            `#${log.ticket_id?.slice(0, 8)}`}
                        </div>
                        <div style={{ fontSize: "12px", color: "#8E8E93" }}>
                          {log.action} •{" "}
                          {new Date(log.scanned_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                      <span
                        className={`badge ${log.result === "success" ? "badge-green" : "badge-red"
                          }`}
                      >
                        {log.result}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* MANUAL TOKEN MODAL */}
      {showManualModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <h3
              style={{ fontSize: "20px", fontWeight: "700", marginBottom: "12px" }}
            >
              Manual Token Input
            </h3>
            <p
              style={{
                fontSize: "13px",
                color: "#8E8E93",
                marginBottom: "10px",
              }}
            >
              Paste the full URL from the CSV&apos;s <code>qr_url</code> column
              (starts with <code>http://</code> and contains <code>/t/</code>).
              Do <strong>not</strong> paste the ticket ID.
            </p>
            <textarea
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="http://localhost:3000/t/AQEBAYGB…"
              rows={4}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "12px",
                border: "1px solid rgba(0,0,0,0.15)",
                fontSize: "14px",
                fontFamily: "monospace",
                marginBottom: "16px",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => {
                  setShowManualModal(false);
                  if (manualToken.trim()) handleRawScan(manualToken.trim());
                }}
                className="btn-primary"
              >
                Verify &amp; Scan
              </button>
              <button
                onClick={() => setShowManualModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEARCH MODAL */}
      {showSearchModal && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxHeight: "80vh" }}>
            <h3
              style={{ fontSize: "20px", fontWeight: "700", marginBottom: "12px" }}
            >
              Search Participant
            </h3>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.length >= 2) {
                  api
                    .searchParticipants(e.target.value)
                    .then((res) => setSearchResults(res.results))
                    .catch(() => { });
                }
              }}
              placeholder="Name, email, college…"
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "12px",
                border: "1px solid rgba(0,0,0,0.15)",
                marginBottom: "14px",
                outline: "none",
              }}
            />
            <div
              style={{
                maxHeight: "260px",
                overflowY: "auto",
                marginBottom: "16px",
              }}
            >
              {searchResults.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    setShowSearchModal(false);
                    if (item.ticket_id) {
                      setScanResult({
                        ticket: { id: item.ticket_id },
                        participant: {
                          name: item.name,
                          email: item.email,
                          college: item.college,
                        },
                        event: { id: "", name: "Event" },
                        lease_expiry: new Date(
                          Date.now() + 60000
                        ).toISOString(),
                      });
                    }
                  }}
                  style={{
                    padding: "10px",
                    borderBottom: "1px solid rgba(0,0,0,0.06)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: "600", fontSize: "14px" }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: "12px", color: "#8E8E93" }}>
                    {item.email}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowSearchModal(false)}
              className="btn-secondary"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}