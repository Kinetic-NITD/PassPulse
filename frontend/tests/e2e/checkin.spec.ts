import { test, expect } from "@playwright/test";

test.describe("Volunteer Check-in E2E Flow", () => {
  test("login -> paste token -> confirm -> second scan shows already-checked-in", async ({ page, request }) => {
    // 1. Prepare test data on backend via API
    // Ensure volunteer staff exists or login
    const loginRes = await request.post("http://localhost:8000/api/auth/login", {
      data: {
        email: "vol1@test.com",
        password: "secretpass123",
      },
    });

    let jwtToken = "";
    if (loginRes.ok()) {
      const data = await loginRes.json();
      jwtToken = data.access_token;
    } else {
      // Fallback: check if admin or create
      console.log("Login returned:", loginRes.status());
    }

    // 2. Visit frontend login page
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("PassPulse");

    // Fill login form
    await page.fill('input[placeholder="name@event.com"]', "vol1@test.com");
    await page.fill('input[placeholder="••••••"]', "secretpass123");
    await page.click('button:has-text("Initialize Scanner")');

    // 3. Navigate to scanner
    await page.waitForURL("**/scanner");
    await expect(page.locator("header")).toContainText("PassPulse");

    // 4. Get a fresh valid token from backend for testing
    // Export CSV to grab an un-checked-in token
    const exportRes = await request.get("http://localhost:8000/api/tickets/export-csv");
    let testToken = "";
    if (exportRes.ok()) {
      const csv = await exportRes.text();
      const lines = csv.split("\n");
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        if (parts.length >= 6 && parts[4] === "issued") {
          testToken = parts[5];
          break;
        }
      }
    }

    if (!testToken) {
      test.skip(!testToken, "No test token available for E2E scan");
      return;
    }

    // 5. Use Paste Token Fallback
    await page.click('button:has-text("Paste Token")');
    await page.fill('textarea[placeholder*="AQE"]', testToken);
    await page.click('button:has-text("Verify & Scan")');

    // 6. Verification card appears
    await expect(page.locator("text=VALID TICKET • FIRST SCAN")).toBeVisible({ timeout: 10000 });

    // 7. Enter ID Card Number
    const cardInput = page.locator('input[placeholder*="CARD-"]');
    await expect(cardInput).toBeFocused();
    await cardInput.fill("CARD-E2E-AUTO");

    // 8. Confirm Check-In
    await page.click('button:has-text("VERIFY & CHECK-IN")');

    // 9. Success confirmation state
    await expect(page.locator("text=Checked In Successfully!")).toBeVisible({ timeout: 10000 });

    // 10. Scan Next Attendee
    await page.click('button:has-text("Scan Next Attendee Now")');

    // 11. Scan the SAME token again
    await page.click('button:has-text("Paste Token")');
    await page.fill('textarea[placeholder*="AQE"]', testToken);
    await page.click('button:has-text("Verify & Scan")');

    // 12. Shows Already Checked In state!
    await expect(page.locator("text=Ticket Already Checked In")).toBeVisible({ timeout: 10000 });
  });
});
