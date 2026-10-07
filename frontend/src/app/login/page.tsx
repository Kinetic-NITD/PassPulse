"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken, setStaff } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [assignedGate, setAssignedGate] = useState("Gate 02 — Main Arena Entry");
  const [keepActive, setKeepActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in both email and password");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.login(email, password);
      setToken(res.access_token);
      setStaff(res.staff);

      if (res.staff.role === "admin") {
        router.push("/admin");
      } else {
        router.push("/scanner");
      }
    } catch (err: any) {
      setError(err?.detail?.message || err?.detail || err?.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 16px",
      backgroundColor: "#F2F4F7",
    }}>
      <div style={{ width: "100%", maxWidth: "380px" }}>
        {/* App Icon */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
          <div style={{
            width: "68px",
            height: "68px",
            borderRadius: "18px",
            backgroundColor: "#161B22",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7V5a2 2 0 0 1 2-2h2"></path>
              <path d="M17 3h2a2 2 0 0 1 2 2v2"></path>
              <path d="M21 17v2a2 2 0 0 1-2 2h-2"></path>
              <path d="M7 21H5a2 2 0 0 1-2-2v-2"></path>
              <polyline points="7 12 10 15 17 8"></polyline>
            </svg>
          </div>
        </div>

        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: "700", letterSpacing: "-0.5px", color: "#1C1C1E" }}>
            PassPulse
          </h1>
          <p style={{ fontSize: "15px", color: "#8E8E93", marginTop: "4px" }}>
            Volunteer Gate Portal
          </p>
        </div>

        {error && (
          <div style={{
            backgroundColor: "#FEECEB",
            color: "#C62828",
            padding: "12px 16px",
            borderRadius: "12px",
            fontSize: "14px",
            marginBottom: "16px",
            border: "1px solid rgba(198,40,40,0.15)",
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          {/* Main Credentials Group */}
          <div style={{
            backgroundColor: "#FFFFFF",
            borderRadius: "18px",
            border: "1px solid rgba(0,0,0,0.06)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
            overflow: "hidden",
            marginBottom: "16px",
          }}>
            {/* Field 1: Volunteer Identifier */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: "600", letterSpacing: "0.5px", color: "#8E8E93", textTransform: "uppercase", marginBottom: "4px" }}>
                Volunteer Identifier / Email
              </label>
              <div style={{ display: "flex", alignItems: "center" }}>
                <input
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@event.com"
                  autoCapitalize="none"
                  autoCorrect="off"
                  style={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    fontSize: "16px",
                    fontWeight: "500",
                    color: "#1C1C1E",
                    background: "transparent",
                  }}
                />
                {email && (
                  <button type="button" onClick={() => setEmail("")} style={{ color: "#8E8E93", padding: "4px" }}>
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Field 2: Passcode */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: "600", letterSpacing: "0.5px", color: "#8E8E93", textTransform: "uppercase", marginBottom: "4px" }}>
                Security Passcode
              </label>
              <div style={{ display: "flex", alignItems: "center" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  style={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    fontSize: "16px",
                    fontWeight: "500",
                    color: "#1C1C1E",
                    background: "transparent",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ color: "#8E8E93", fontSize: "13px", padding: "4px 8px" }}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {/* Field 3: Assigned Gate */}
            <div style={{ padding: "14px 18px" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: "600", letterSpacing: "0.5px", color: "#8E8E93", textTransform: "uppercase", marginBottom: "4px" }}>
                Assigned Gate
              </label>
              <select
                value={assignedGate}
                onChange={(e) => setAssignedGate(e.target.value)}
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  fontSize: "15px",
                  fontWeight: "500",
                  color: "#1C1C1E",
                  background: "transparent",
                  appearance: "none",
                  WebkitAppearance: "none",
                }}
              >
                <option value="Gate 01 — VIP & Media Entrance">Gate 01 — VIP & Media Entrance</option>
                <option value="Gate 02 — Main Arena Entry">Gate 02 — Main Arena Entry</option>
                <option value="Gate 03 — East Turnstiles">Gate 03 — East Turnstiles</option>
                <option value="Gate 04 — North Staff Gate">Gate 04 — North Staff Gate</option>
              </select>
            </div>
          </div>

          {/* Keep active toggle card */}
          <div style={{
            backgroundColor: "#FFFFFF",
            borderRadius: "18px",
            border: "1px solid rgba(0,0,0,0.06)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "24px",
          }}>
            <div>
              <div style={{ fontSize: "15px", fontWeight: "600", color: "#1C1C1E" }}>
                Keep terminal active
              </div>
              <div style={{ fontSize: "13px", color: "#8E8E93" }}>
                Stay signed in for this shift
              </div>
            </div>
            <label style={{ position: "relative", display: "inline-block", width: "50px", height: "30px" }}>
              <input
                type="checkbox"
                checked={keepActive}
                onChange={(e) => setKeepActive(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span style={{
                position: "absolute",
                cursor: "pointer",
                inset: 0,
                backgroundColor: keepActive ? "#007AFF" : "#E5E5EA",
                borderRadius: "30px",
                transition: "0.2s",
              }}>
                <span style={{
                  position: "absolute",
                  height: "26px",
                  width: "26px",
                  left: keepActive ? "22px" : "2px",
                  bottom: "2px",
                  backgroundColor: "white",
                  borderRadius: "50%",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                  transition: "0.2s",
                }}></span>
              </span>
            </label>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{ padding: "16px", fontSize: "17px", borderRadius: "14px" }}
          >
            {loading ? "Authenticating..." : "Initialize Scanner →"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: "24px", fontSize: "13px", color: "#8E8E93" }}>
          Credentials provided by your event organiser.
        </div>
      </div>
    </div>
  );
}
