export default function PublicTicketPage({ params }: { params: { token: string } }) {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#0B0F19",
      color: "#FFFFFF",
      padding: "20px",
      textAlign: "center",
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
    }}>
      <div style={{
        backgroundColor: "rgba(255, 255, 255, 0.05)",
        borderRadius: "24px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        padding: "40px 24px",
        maxWidth: "360px",
        width: "100%",
        boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
      }}>
        <div style={{
          width: "60px",
          height: "60px",
          borderRadius: "16px",
          backgroundColor: "#161B22",
          border: "1px solid rgba(255,255,255,0.1)",
          margin: "0 auto 20px auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "28px",
        }}>
          🎟️
        </div>

        <h1 style={{ fontSize: "22px", fontWeight: "700", marginBottom: "8px", color: "#007AFF" }}>
          Event Pass
        </h1>
        <p style={{ fontSize: "14px", color: "#8E8E93", lineHeight: 1.5, marginBottom: "24px" }}>
          Show this QR code at the check-in gate for entry.
        </p>

        <div style={{
          backgroundColor: "#FFFFFF",
          padding: "16px",
          borderRadius: "16px",
          display: "inline-block",
          marginBottom: "20px",
        }}>
          {/* Simple SVG QR placeholder or QR image */}
          <div style={{ width: "160px", height: "160px", display: "flex", alignItems: "center", justifyContent: "center", color: "#1C1C1E", fontSize: "12px", textAlign: "center" }}>
            [Present your digital pass QR on your device]
          </div>
        </div>

        <div style={{ fontSize: "11px", color: "#636366" }}>
          PassPulse Single-Use Turnstile Security
        </div>
      </div>
    </div>
  );
}
