import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => ({ dns: vi.fn(), send: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.dns }));
vi.mock("node:http", () => ({ request: mocks.send }));
vi.mock("node:https", () => ({ request: mocks.send }));

import { extractName, extractProduct, isPublicAddress, lookupProduct, safeLookupUrl } from "../src/lib/lookup";

describe("product lookup safety", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.dns.mockResolvedValue([{ address: "93.184.215.14", family: 4 }]); });
  it.each(["127.0.0.1", "10.0.0.1", "172.16.4.2", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"])("blocks nonpublic address %s", address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(["http://localhost", "http://127.1", "http://2130706433", "https://[::1]", "https://example.com:8443", "https://user@example.com", "file:///etc/passwd", "http://printer.local"])("rejects unsafe URL %s", url => {
    expect(() => safeLookupUrl(url)).toThrow();
  });
  it("rejects DNS results with any private address before making a request", async () => {
    mocks.dns.mockResolvedValue([{ address: "93.184.215.14", family: 4 }, { address: "10.0.0.2", family: 4 }]);
    await expect(lookupProduct("https://supplier.example/product")).rejects.toThrow("Private addresses");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  function respond(statusCode: number, headers: Record<string, string>, body = "") {
    mocks.send.mockImplementationOnce((_url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void };
      request.end = () => {
        const response = Object.assign(new EventEmitter(), { statusCode, headers, destroy: vi.fn() });
        callback(response);
        queueMicrotask(() => { response.emit("data", Buffer.from(body)); response.emit("end"); });
      };
      return request;
    });
  }
  it("pins the checked address and preserves Host/SNI", async () => {
    respond(200, { "content-type": "text/html" }, "<title>Acetone</title>");
    expect((await lookupProduct("https://supplier.example/product")).name).toBe("Acetone");
    expect(mocks.send.mock.calls[0][1]).toMatchObject({ hostname: "93.184.215.14", servername: "supplier.example", agent: false, headers: { Host: "supplier.example" } });
  });
  it("blocks redirects into private networks", async () => {
    respond(302, { location: "http://169.254.169.254/latest/meta-data" });
    await expect(lookupProduct("https://supplier.example/product")).rejects.toThrow();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("bounds redirects and response sizes", async () => {
    for (let count = 0; count < 4; count++) respond(302, { location: "/again" });
    await expect(lookupProduct("https://supplier.example/product")).rejects.toThrow("Too many");
    respond(200, { "content-type": "text/html" }, "x".repeat(512 * 1024 + 1));
    await expect(lookupProduct("https://supplier.example/product")).rejects.toThrow("too large");
  });
  it("rejects non-HTML content", async () => {
    respond(200, { "content-type": "application/pdf" });
    await expect(lookupProduct("https://supplier.example/product")).rejects.toThrow("cannot be read");
  });
});

describe("name extraction", () => {
  it("suggests SKU without conflating it with the barcode or losing leading zeros", () => {
    expect(extractProduct('<script type="application/ld+json">{"@type":"Product","name":"Acetone","sku":"001-AC","gtin13":"1234567890123","mpn":"OTHER"}</script>'))
      .toEqual({ name: "Acetone", catalogue_number: "001-AC", source: "Product metadata" });
  });
  it("uses MPN if SKU is absent and does not guess from a GTIN or title", () => {
    expect(extractProduct('<script type="application/ld+json">{"@type":"Product","mpn":" AB-012 "}</script>').catalogue_number).toBe("AB-012");
    expect(extractProduct('<title>AB-012 Product</title><script type="application/ld+json">{"@type":"Product","gtin13":"1234567890123"}</script>').catalogue_number).toBeNull();
  });
  it("does not choose an identifier from ambiguous multiple-product metadata", () => {
    expect(extractProduct('<script type="application/ld+json">[{"@type":"Product","sku":"ONE"},{"@type":"Product","sku":"TWO"}]</script>').catalogue_number).toBeNull();
  });
  it("rejects malformed identifiers instead of truncating or converting them", () => {
    for (const sku of ["A".repeat(121), 123, "   ", "AB\nCD", { value: "123" }]) {
      expect(extractProduct(`<script type="application/ld+json">${JSON.stringify({ "@type": "Product", sku })}</script>`).catalogue_number).toBeNull();
    }
  });
  it("prefers Product JSON-LD over a generic page title", () => {
    expect(extractName('<title>Supplier</title><script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Sodium chloride"}]}</script>'))
      .toEqual({ name: "Sodium chloride", source: "Product metadata" });
  });
  it("supports arrays and schema-qualified Product types", () => {
    expect(extractName('<script type="application/ld+json">[{"@type":["https://schema.org/Product"],"name":"Acetone"}]</script>').name).toBe("Acetone");
  });
  it("falls back to page metadata and never executes scripts", () => {
    expect(extractName('<script type="application/ld+json">broken</script><script>throw new Error()</script><meta property="og:title" content="Ethanol &amp; reagents">').name).toBe("Ethanol & reagents");
    expect(extractName("<body>No product information</body>").name).toBeNull();
  });
  it("bounds names and collapses whitespace", () => {
    expect(extractName(`<title> ${"A".repeat(300)} </title>`).name).toHaveLength(180);
    expect(extractName("<title>  Acetone\n  99% </title>").name).toBe("Acetone 99%");
  });
});
