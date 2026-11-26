import { expect, test, type Page } from "@playwright/test";

async function signupForm(page: Page, email: string) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByRole("button", { name: "Student account" }).click();
  await page.getByLabel("Your name").fill("New Student");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("different-password-123");
}

test.beforeEach(async ({ request }) => { await request.post("http://127.0.0.1:54329/reset"); });

test("existing verified signup shows a clear message and preserves the original account", async ({ page }) => {
  await signupForm(page, "LAB@example.test");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("An account with this email already exists. Sign in or reset your password instead.");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Email confirmation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Sign in instead", exact: true }).click();
  await expect(page.getByLabel("Email address")).toHaveValue("LAB@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chemistry Lab", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ethanol", exact: true })).toBeVisible();
});

test("explicit duplicate signup errors offer password reset with the email retained", async ({ page }) => {
  await page.route("**/auth/v1/signup?*", route => route.fulfill({ status: 422, json: { code: "user_already_exists", msg: "User already registered" } }));
  await signupForm(page, "student@example.test");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("already exists");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Forgot your password?", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveValue("student@example.test");
  const recovery = page.waitForRequest(request => request.url().includes("/auth/v1/recover") && request.method() === "POST");
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();
  expect((await recovery).postDataJSON()).toMatchObject({ email: "student@example.test" });
  await expect(page.getByRole("status")).toContainText("password reset link");
});

test("repeated signup for an unverified user keeps confirmation available without creating another user", async ({ page }) => {
  await signupForm(page, "unverified@example.test");
  const firstResponse = page.waitForResponse(response => response.url().includes("/auth/v1/signup") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const firstUser = await (await firstResponse).json();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await signupForm(page, "unverified@example.test");
  const secondResponse = page.waitForResponse(response => response.url().includes("/auth/v1/signup") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  expect((await (await secondResponse).json()).id).toBe(firstUser.id);
  await expect(page.getByRole("status")).toContainText("Check your email");
  await expect(page.getByRole("button", { name: /Resend confirmation email/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in instead", exact: true })).toHaveCount(0);
});

test("changing the address clears duplicate messaging and old confirmation controls", async ({ page }) => {
  await signupForm(page, "student@example.test");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("already exists");
  await page.getByLabel("Email address").fill("fresh@example.test");
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await expect(page.getByRole("region", { name: "Email confirmation" })).toContainText("fresh@example.test");
  await page.getByLabel("Email address").fill("another@example.test");
  await expect(page.getByRole("region", { name: "Email confirmation" })).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});
