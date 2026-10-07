"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistrar() {
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!("serviceWorker" in navigator)) return;
        if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
            return;
        }

        const register = () => {
            navigator.serviceWorker
                .register("/sw.js", { scope: "/" })
                .catch((err) => console.warn("SW registration failed:", err));
        };

        if (document.readyState === "complete") register();
        else window.addEventListener("load", register, { once: true });
    }, []);

    return null;
}