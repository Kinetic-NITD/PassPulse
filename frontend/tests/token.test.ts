import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { verifyToken, extractToken, parseToken } from "../src/lib/token";

describe("Frontend Token Verification against Backend Vectors", () => {
  const vectorsPath = path.resolve(__dirname, "../../backend/tests/vectors.json");
  const vectorsData = JSON.parse(fs.readFileSync(vectorsPath, "utf-8"));
  const keys = vectorsData.keys;

  for (const tc of vectorsData.cases) {
    it(`handles case: ${tc.name}`, async () => {
      const result = await verifyToken(tc.token, keys);

      if (tc.expected_valid) {
        expect(result.valid).toBe(true);
        expect(result.parsed).toBeDefined();
        expect(result.parsed?.keyId).toBe(tc.expected_key_id);
        expect(result.parsed?.ticketId).toBe(tc.expected_ticket_id);
      } else {
        expect(result.valid).toBe(false);
        expect(result.error).toBe(tc.expected_error);
      }
    });
  }

  it("extracts token from full URL", () => {
    const url = "https://events.example.com/t/AQESNFZ4EjRWeBI0VngSNFZ4taX5lQOOfPeqvMiOzLBLxxTyI8_Q1Cb6yRCOrFauSO-E8eOWBYuloY6R_6BeUoWbfqkd6XeCjQRNnxHkd5vCCA";
    const token = extractToken(url);
    expect(token).toBe("AQESNFZ4EjRWeBI0VngSNFZ4taX5lQOOfPeqvMiOzLBLxxTyI8_Q1Cb6yRCOrFauSO-E8eOWBYuloY6R_6BeUoWbfqkd6XeCjQRNnxHkd5vCCA");
  });

  it("extracts bare token unchanged", () => {
    const raw = "AQESNFZ4EjRWeBI0VngSNFZ4taX5lQOOfPeqvMiOzLBLxxTyI8_Q1Cb6yRCOrFauSO-E8eOWBYuloY6R_6BeUoWbfqkd6XeCjQRNnxHkd5vCCA";
    expect(extractToken(raw)).toBe(raw);
  });
});
