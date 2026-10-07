"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken, getStaff } from "@/lib/api";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const token = getToken();
    const staff = getStaff();

    if (!token || !staff) {
      router.replace("/login");
    } else if (staff.role === "admin") {
      router.replace("/admin");
    } else {
      router.replace("/scanner");
    }
  }, [router]);

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <p style={{ color: "#8E8E93" }}>Loading PassPulse...</p>
    </div>
  );
}
