import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email = "lab@example.test") {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
}

async function rememberEthanol(page: Page) {
  await signIn(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Catalogue Number", { exact: true }).fill("ETH-001");
  await modal.getByText("Advanced stock settings", { exact: true }).click();
  await modal.getByLabel("Minimum units", { exact: true }).fill("3");
  await modal.getByLabel("Minimum remaining quantity").fill("2000");
  await modal.getByRole("checkbox", { name: /I have verified these public product details/ }).check();
  await modal.getByRole("checkbox", { name: /This barcode\/QR identifies/ }).check();
  await modal.getByRole("checkbox", { name: /This is a public supplier product link/ }).check();
  await modal.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Confirmed product details remembered");
}

async function scan(page: Page, value: string, catalogue = false) {
  await page.getByRole("button", { name: "Scan product", exact: true }).click();
  if (catalogue) await page.getByRole("combobox", { name: "Code type", exact: true }).selectOption("CATALOGUE_NUMBER");
  await page.getByLabel(catalogue ? "Enter catalogue number" : "Or enter barcode / product URL", { exact: true }).fill(value);
  await page.getByRole("button", { name: "Use this code", exact: true }).click();
}

test.beforeEach(async ({ request }) => { await request.post("http://127.0.0.1:54329/reset"); });

test("a second lab reuses confirmed product details, not inventory, and remembers another QR alias", async ({ page }) => {
  await rememberEthanol(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, "other@example.test");
  await expect(page.getByRole("heading", { name: "Ethanol", exact: true })).toHaveCount(0);
  let onlineLookups = 0;
  await page.route("**/api/lookup", route => { onlineLookups++; return route.fulfill({ json: { name: "SHOULD NOT BE USED" } }); });
  await scan(page, "1234567890123");
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("status")).toContainText("shared BenchMark product catalogue");
  await expect(modal.getByLabel("Product name", { exact: true })).toHaveValue("Ethanol");
  await expect(modal.getByLabel("Manufacturer/Supplier", { exact: true })).toHaveValue("Test Supplier");
  await expect(modal.getByLabel("Catalogue Number", { exact: true })).toHaveValue("ETH-001");
  await expect(modal.getByLabel("Amount per unit")).toHaveValue("1000");
  await expect(modal.getByRole("combobox", { name: "Unit", exact: true })).toHaveValue("mL");
  await expect(modal.getByLabel("Number of units", { exact: true })).toHaveValue("");
  await expect(modal.getByLabel("Total remaining quantity", { exact: true })).toHaveValue("");
  await expect(modal.getByLabel("Product link")).toHaveValue("https://example.com/ethanol");
  await modal.getByText("Advanced stock settings", { exact: true }).click();
  await expect(modal.getByLabel("Minimum units", { exact: true })).toHaveValue("");
  await expect(modal.getByLabel("Minimum remaining quantity")).toHaveValue("");
  await expect(modal).not.toContainText("Chemistry Lab");
  await modal.getByLabel("Number of units", { exact: true }).fill("1");
  await modal.getByLabel("Total remaining quantity", { exact: true }).fill("400");
  await modal.getByLabel("Barcode / scanned value").fill("https://example.com/ethanol");
  await modal.getByRole("checkbox", { name: /I have verified these public product details/ }).check();
  await modal.getByRole("checkbox", { name: /This barcode\/QR identifies/ }).check();
  await modal.getByRole("button", { name: "Add to inventory", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".product-quantity")).toContainText("400");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page);
  await expect(page.locator(".product-quantity")).toContainText("1,000");
  await scan(page, "https://example.com/ethanol");
  await expect(modal).toHaveAccessibleName("Edit product");
  await expect(modal.getByLabel("Number of units", { exact: true })).toHaveValue("2");
  await expect(modal.getByLabel("Total remaining quantity", { exact: true })).toHaveValue("1000");
  expect(onlineLookups).toBe(0);
});

test("catalogue-number entry finds shared details and repeat scans reopen the local product", async ({ page }) => {
  await rememberEthanol(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, "other@example.test");
  await scan(page, "eth-001", true);
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("Product name", { exact: true })).toHaveValue("Ethanol");
  await expect(modal.getByLabel("Barcode / scanned value")).toHaveValue("");
  await modal.getByLabel("Number of units", { exact: true }).fill("1");
  await modal.getByLabel("Total remaining quantity", { exact: true }).fill("200");
  await modal.getByRole("button", { name: "Add to inventory", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await scan(page, "ETH-001", true);
  await expect(modal).toHaveAccessibleName("Edit product");
  await expect(modal.getByLabel("Total remaining quantity", { exact: true })).toHaveValue("200");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Add manually", exact: true }).click();
  await modal.getByLabel("Catalogue Number", { exact: true }).fill("ETH-001");
  await modal.getByRole("button", { name: "Find saved product", exact: true }).click();
  await expect(modal).toHaveAccessibleName("Edit product");
  await expect(modal.getByLabel("Total remaining quantity", { exact: true })).toHaveValue("200");
});

test("conflicting confirmations never overwrite a shared product and can be saved privately", async ({ page }) => {
  await rememberEthanol(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, "other@example.test");
  await scan(page, "ETH-001", true);
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("Product name", { exact: true })).toHaveValue("Ethanol");
  await modal.getByLabel("Product name", { exact: true }).fill("My lab's private nickname");
  await modal.getByLabel("Number of units", { exact: true }).fill("1");
  await modal.getByLabel("Total remaining quantity", { exact: true }).fill("200");
  const confirmation = modal.getByRole("checkbox", { name: /I have verified these public product details/ });
  await confirmation.check();
  await modal.getByRole("button", { name: "Add to inventory", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("Nothing was saved");
  await confirmation.uncheck();
  await modal.getByRole("button", { name: "Add to inventory", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "My lab's private nickname", exact: true })).toBeVisible();
});

test("ambiguous suppliers and package sizes need an explicit selection", async ({ page }) => {
  const matches = [
    { id: "one", name: "Alcohol A", manufacturer_supplier: "Supplier A", catalogue_number: "001", container_size: 2.5, unit: "L", product_url: null },
    { id: "two", name: "Alcohol B", manufacturer_supplier: "Supplier B", catalogue_number: "001", container_size: 500, unit: "mL", product_url: null },
  ];
  await page.route("**/rest/v1/rpc/lookup_product_catalogue", route => route.fulfill({ json: matches }));
  await signIn(page, "other@example.test");
  await scan(page, "001", true);
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("status")).toContainText("Choose the matching manufacturer");
  await expect(modal.getByLabel("Product name", { exact: true })).toHaveValue("");
  await modal.getByRole("button", { name: /Alcohol B/ }).click();
  await expect(modal.getByLabel("Product name", { exact: true })).toHaveValue("Alcohol B");
  await expect(modal.getByLabel("Manufacturer/Supplier", { exact: true })).toHaveValue("Supplier B");
  await expect(modal.getByLabel("Amount per unit")).toHaveValue("500");
  await expect(modal.getByLabel("Number of units", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("late catalogue responses do not replace edits or publish suggestions automatically", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route("**/rest/v1/rpc/lookup_product_catalogue", async route => {
    requested = true; await gate;
    await route.fulfill({ json: [{ id: "one", name: "Old result", manufacturer_supplier: "Supplier A", catalogue_number: "001", container_size: 2.5, unit: "L", product_url: null }] });
  });
  await signIn(page, "other@example.test");
  await scan(page, "001", true);
  const modal = page.getByRole("dialog");
  await expect.poll(() => requested).toBe(true);
  await modal.getByLabel("Product name", { exact: true }).fill("My verified name");
  release();
  await expect(modal.getByRole("status")).toContainText("Details changed");
  await expect(modal.getByLabel("Product name", { exact: true })).toHaveValue("My verified name");
  await expect(modal.getByRole("checkbox", { name: /I have verified these public product details/ })).not.toBeChecked();
});
