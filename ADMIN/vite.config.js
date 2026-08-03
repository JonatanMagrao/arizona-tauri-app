import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { adminConfig } from "./src/config.js";

function contentSecurityPolicy({ development = false } = {}) {
  const connectSources = [
    "'self'",
    adminConfig.supabaseUrl,
    ...(development ? ["ws://127.0.0.1:*"] : []),
  ];
  const scriptSources = [
    "'self'",
    ...(development ? ["'unsafe-inline'"] : []),
  ];

  return [
    "default-src 'self'",
    "base-uri 'none'",
    `connect-src ${connectSources.join(" ")}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self' data: blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; ");
}

function securityHeaders(csp) {
  return {
    "Content-Security-Policy": csp,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

export default defineConfig(({ command }) => {
  const productionCsp = contentSecurityPolicy();

  return {
    plugins: [
      react(),
      {
        name: "admin-security-meta",
        transformIndexHtml() {
          if (command !== "build") return [];
          return [{
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content: productionCsp,
            },
            injectTo: "head-prepend",
          }];
        },
      },
    ],
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      port: 1430,
      strictPort: true,
      headers: securityHeaders(contentSecurityPolicy({ development: true })),
    },
    preview: {
      host: "127.0.0.1",
      port: 1431,
      strictPort: true,
      headers: securityHeaders(productionCsp),
    },
  };
});
