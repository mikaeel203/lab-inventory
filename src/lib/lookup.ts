import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import { productUrl } from "./inventory";

const maxBytes = 512 * 1024;

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === "unicast"; }
  catch { return false; }
}

export function safeLookupUrl(value: string): URL {
  const parsed = productUrl(value);
  if (!parsed) throw new Error("Not a supported product URL.");
  const url = new URL(parsed);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.port || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || host.endsWith(".internal") || (ipaddr.isValid(host) && !isPublicAddress(host))) {
    throw new Error("This address is not available for product lookup.");
  }
  url.hash = "";
  return url;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 180) : null;
}

function structuredProducts(value: unknown, depth = 0): Record<string, unknown>[] {
  if (!value || depth > 8 || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap(entry => structuredProducts(entry, depth + 1));
  }
  const record = value as Record<string, unknown>;
  const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
  if (types.some(type => typeof type === "string" && /(^|[/#])Product$/.test(type))) {
    return [record];
  }
  return [...structuredProducts(record["@graph"], depth + 1), ...structuredProducts(record.mainEntity, depth + 1)];
}

function cleanCatalogueNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const number = value.trim();
  return number && number.length <= 120 && !/[\u0000-\u001f\u007f]/.test(number) ? number : null;
}

export function extractProduct(html: string): { name: string | null; catalogue_number: string | null; source: string | null } {
  const document = load(html);
  const products: Record<string, unknown>[] = [];
  for (const script of document('script[type="application/ld+json"]').toArray()) {
    try {
      products.push(...structuredProducts(JSON.parse(document(script).text())));
    } catch { }
  }
  const product = products.length === 1 ? products[0] : undefined;
  const structuredName = cleanName(product?.name);
  const catalogueNumber = cleanCatalogueNumber(product?.sku) ?? cleanCatalogueNumber(product?.mpn);
  const name = structuredName ?? cleanName(document('meta[property="og:title"]').attr("content")) ?? cleanName(document("title").first().text());
  return { name, catalogue_number: catalogueNumber, source: structuredName || catalogueNumber ? "Product metadata" : name ? "Page title — please verify" : null };
}

export function extractName(html: string): { name: string | null; source: string | null } {
  const { name, source } = extractProduct(html);
  return { name, source };
}

type Page = { html?: string; redirect?: string };

async function fetchPage(url: URL, signal: AbortSignal): Promise<Page> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await Promise.race([
    lookup(host, { all: true }),
    delay(2000, undefined, { ref: false }).then(() => { throw new Error("Name lookup timed out."); }),
  ]);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) throw new Error("Private addresses are not supported.");
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(url, {
      hostname: address.address, family: address.family, servername: host, signal, agent: false,
      headers: { Host: url.host, Accept: "text/html, application/xhtml+xml", "Accept-Encoding": "identity", "User-Agent": "BenchMark/0.1 ProductMetadata" },
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        const redirect = response.headers.location;
        response.destroy();
        if (!redirect) reject(new Error("Missing redirect address."));
        else resolve({ redirect });
        return;
      }
      if (response.statusCode !== 200 || !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(response.headers["content-type"] ?? "")
        || Number(response.headers["content-length"] ?? 0) > maxBytes
        || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
        response.destroy(); reject(new Error("This page cannot be read for product information.")); return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) { response.destroy(); reject(new Error("Product page is too large.")); }
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

export async function lookupProduct(value: string) {
  let url = safeLookupUrl(value);
  const signal = AbortSignal.timeout(8000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const page = await fetchPage(url, signal);
    if (page.redirect) { url = safeLookupUrl(new URL(page.redirect, url).href); continue; }
    return { ...extractProduct(page.html ?? ""), url: url.href };
  }
  throw new Error("Too many product-page redirects.");
}
