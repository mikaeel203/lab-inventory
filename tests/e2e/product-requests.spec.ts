import { devices, expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
}

async function openTab(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("button", { name: new RegExp(`^${name}`) }).click();
}

async function joinLab(ownerPage: Page, studentPage: Page) {
  await signIn(ownerPage, "lab@example.test");
  await openTab(ownerPage, "Requests");
  await signIn(studentPage, "student@example.test");
  await expect(studentPage.getByRole("button", { name: "Add manually", exact: true })).toHaveCount(0);
  await expect(studentPage.getByRole("button", { name: "Scan product", exact: true })).toHaveCount(0);
  await studentPage.getByRole("button", { name: "Find a lab", exact: true }).last().click();
  await studentPage.locator(".directory-row").filter({ hasText: "Chemistry Lab" }).getByRole("button", { name: "Request to join" }).click();
  await ownerPage.getByRole("button", { name: "Approve", exact: true }).click();
  await openTab(studentPage, "Inventory");
  await expect(studentPage.getByRole("button", { name: "Add manually", exact: true })).toBeVisible();
}

async function fillProduct(page: Page, name: string, catalogue: string) {
  const modal = page.getByRole("dialog", { name: "Submit a new product", exact: true });
  await modal.getByLabel("Product name", { exact: true }).fill(name);
  await modal.getByLabel("Manufacturer/Supplier", { exact: true }).fill("Test Supplier");
  await modal.getByLabel("Catalogue Number", { exact: true }).fill(catalogue);
  await modal.getByRole("combobox", { name: "Unit", exact: true }).selectOption("L");
  await modal.getByLabel("Number of units", { exact: true }).fill("2");
  await modal.getByLabel("Amount per unit").fill("2.5");
  await modal.getByLabel("Total remaining quantity", { exact: true }).fill("3.5");
  await expect(modal.getByRole("checkbox")).toHaveCount(0);
  return modal;
}

test.beforeEach(async ({ request }) => { await request.post("http://127.0.0.1:54329/reset"); });

test("student manual and QR submissions reach the lab and only approved products enter inventory", async ({ page, browser, isMobile }) => {
  const studentContext = await browser.newContext(isMobile ? devices["Pixel 7"] : {});
  const studentPage = await studentContext.newPage();
  try {
    await joinLab(page, studentPage);
    await studentPage.getByRole("button", { name: "Add manually", exact: true }).click();
    const modal = await fillProduct(studentPage, "Student acetone", "STU-001");
    await modal.getByLabel("Barcode / scanned value").fill("STUDENT-CODE");
    await modal.getByLabel("Reason").fill("Found during stocktake");
    await modal.getByRole("button", { name: "Submit product for approval", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(studentPage.getByRole("heading", { name: "Student acetone", exact: true })).toHaveCount(0);

    await studentPage.route("**/api/lookup", route => route.fulfill({ json: { name: "Scanned methanol", catalogue_number: "QR-002", source: "Product metadata" } }));
    await studentPage.getByRole("button", { name: "Scan product", exact: true }).click();
    await studentPage.getByLabel("Or enter barcode / product URL", { exact: true }).fill("https://supplier.example/methanol");
    await studentPage.getByRole("button", { name: "Use this code", exact: true }).click();
    await expect(modal.getByLabel("Product name", { exact: true })).toHaveValue("Scanned methanol");
    await expect(modal.getByLabel("Catalogue Number", { exact: true })).toHaveValue("QR-002");
    await fillProduct(studentPage, "Scanned methanol", "QR-002");
    await modal.getByRole("button", { name: "Submit product for approval", exact: true }).click();
    await expect(modal).toHaveCount(0);

    const acetone = page.locator(".request-card").filter({ has: page.getByRole("heading", { name: "Student acetone", exact: true }) });
    const methanol = page.locator(".request-card").filter({ has: page.getByRole("heading", { name: "Scanned methanol", exact: true }) });
    await expect(acetone).toContainText("Alex Student");
    await expect(acetone).toContainText("Test Supplier");
    await expect(acetone).toContainText("STU-001");
    await expect(acetone).toContainText("3.5 L");
    await expect(acetone).toContainText("2.5 L");
    await expect(methanol).toContainText("https://supplier.example/methanol");
    await openTab(page, "Inventory");
    await expect(page.locator(".product-row")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Pending requests 2" })).toBeVisible();
    await openTab(page, "Requests");
    await acetone.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(acetone.locator(".status")).toHaveText("approved");
    await expect(studentPage.getByRole("heading", { name: "Student acetone", exact: true })).toBeVisible();
    await methanol.getByLabel("Response").fill("Check manufacturer label");
    await methanol.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(methanol.locator(".status")).toHaveText("rejected");
    await openTab(studentPage, "Requests");
    const rejected = studentPage.locator(".request-card").filter({ hasText: "Scanned methanol" });
    await expect(rejected.locator(".status")).toHaveText("rejected");
    await expect(rejected).toContainText("Check manufacturer label");
    await expect(studentPage.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await openTab(page, "Inventory");
    await expect(page.locator(".product-row")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Scanned methanol", exact: true })).toHaveCount(0);
    await openTab(studentPage, "Inventory");
    await studentPage.getByRole("button", { name: "Scan product", exact: true }).click();
    await studentPage.getByLabel("Or enter barcode / product URL", { exact: true }).fill("STUDENT-CODE");
    await studentPage.getByRole("button", { name: "Use this code", exact: true }).click();
    await expect(studentPage.getByRole("dialog")).toHaveAccessibleName("Request a quantity change");
    await expect(studentPage.getByLabel("Proposed remaining quantity")).toHaveValue("3.5");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await studentContext.close(); }
});

test("student catalogue lookup fills product details and pending additions can be withdrawn with a popup", async ({ page, browser, isMobile }) => {
  const studentContext = await browser.newContext(isMobile ? devices["Pixel 7"] : {});
  const studentPage = await studentContext.newPage();
  studentPage.on("dialog", () => { throw new Error("Unexpected native browser dialog"); });
  try {
    await joinLab(page, studentPage);
    await studentPage.route("**/rest/v1/rpc/lookup_product_catalogue", route => route.fulfill({ json: [
      { id: "shared", name: "Catalogue alcohol", manufacturer_supplier: "Test Supplier", catalogue_number: "SHARED-01", container_size: 2.5, unit: "L", product_url: null },
    ] }));
    await studentPage.getByRole("button", { name: "Scan product", exact: true }).click();
    await studentPage.getByRole("combobox", { name: "Code type", exact: true }).selectOption("CATALOGUE_NUMBER");
    await studentPage.getByLabel("Enter catalogue number", { exact: true }).fill("SHARED-01");
    await studentPage.getByRole("button", { name: "Use this code", exact: true }).click();
    const modal = studentPage.getByRole("dialog");
    await expect(modal.getByLabel("Product name", { exact: true })).toHaveValue("Catalogue alcohol");
    await expect(modal.getByLabel("Number of units", { exact: true })).toHaveValue("");
    await expect(modal.getByLabel("Amount per unit")).toHaveValue("2.5");
    await modal.getByLabel("Number of units", { exact: true }).fill("1");
    await modal.getByLabel("Total remaining quantity", { exact: true }).fill("2");
    await modal.getByRole("button", { name: "Submit product for approval", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await openTab(studentPage, "Requests");
    const card = studentPage.locator(".request-card").filter({ hasText: "Catalogue alcohol" });
    await card.getByRole("button", { name: "Withdraw request", exact: true }).click();
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(card.locator(".status")).toHaveText("pending");
    await card.getByRole("button", { name: "Withdraw request", exact: true }).click();
    await modal.getByRole("button", { name: "Withdraw request", exact: true }).click();
    await expect(card.locator(".status")).toHaveText("cancelled");
    await expect(page.locator(".request-card").filter({ hasText: "Catalogue alcohol" }).locator(".status")).toHaveText("cancelled");
    await openTab(page, "Inventory");
    await expect(page.locator(".product-row")).toHaveCount(1);
  } finally { await studentContext.close(); }
});

test("removing student access cancels their pending product and closes an unsaved editor", async ({ page, browser, isMobile }) => {
  const studentContext = await browser.newContext(isMobile ? devices["Pixel 7"] : {});
  const studentPage = await studentContext.newPage();
  try {
    await joinLab(page, studentPage);
    await studentPage.getByRole("button", { name: "Add manually", exact: true }).click();
    const modal = await fillProduct(studentPage, "Pending product", "PENDING-01");
    await modal.getByRole("button", { name: "Submit product for approval", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await studentPage.getByRole("button", { name: "Add manually", exact: true }).click();
    await expect(modal).toBeVisible();
    await openTab(page, "Students");
    await page.getByRole("button", { name: "Remove access", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove access", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(studentPage.getByRole("button", { name: "Add manually", exact: true })).toHaveCount(0);
    await openTab(page, "Requests");
    await expect(page.locator(".request-card").filter({ hasText: "Pending product" }).locator(".status")).toHaveText("cancelled");
    await openTab(studentPage, "Requests");
    await expect(studentPage.locator(".request-card").filter({ hasText: "Pending product" }).locator(".status")).toHaveText("cancelled");
  } finally { await studentContext.close(); }
});
