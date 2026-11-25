import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";

describe.each([
  { filename: "confirm-signup", type: "signup", button: "Confirm email address" },
  { filename: "reset-password", type: "recovery", button: "Reset my password" },
])("$filename email", ({ filename, type, button }) => {
  const html = readFileSync(new URL(`../supabase/templates/${filename}.html`, import.meta.url), "utf8");
  const document = load(html);

  it("keeps both action links on the app's token-hash callback flow", () => {
    const expected = `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=${type}`;
    expect(document("a")).toHaveLength(2);
    expect(document("a").first().text()).toBe(button);
    document("a").each((_index, element) => { expect(document(element).attr("href")).toBe(expected); });
    expect(document("a").last().text()).toBe(expected);
    expect(html).not.toContain(".ConfirmationURL");
    expect(html).not.toContain("localhost");
  });

  it("renders a complete branded, mobile-friendly email without external dependencies", () => {
    expect(document("html").attr("lang")).toBe("en");
    expect(document("title").text()).toContain("BenchMark");
    expect(document('meta[name="viewport"]').attr("content")).toContain("width=device-width");
    expect(document("h1")).toHaveLength(1);
    expect(document("script, iframe, form, link, img, svg")).toHaveLength(0);
    expect(html).not.toMatch(/@import|url\(/);
    expect(html).toContain("#174c3c");
    expect(html).toContain("#f5f6f2");
    document("table").each((_index, element) => { expect(document(element).attr("role")).toBe("presentation"); });
    expect(document("body").text()).toContain("spam or junk");
    expect(document("body").text()).toContain("Keep this link private");
    expect(document("body").text()).toContain("safely ignore");
  });

  it("produces matching valid URLs after Supabase substitutes the variables", () => {
    const rendered = load(html.replaceAll("{{ .RedirectTo }}", "https://benchmark.example/auth/confirm").replaceAll("{{ .TokenHash }}", "test-token-hash"));
    rendered("a").each((_index, element) => {
      const url = new URL(rendered(element).attr("href")!);
      expect(url.origin).toBe("https://benchmark.example");
      expect(url.pathname).toBe("/auth/confirm");
      expect(url.searchParams.get("token_hash")).toBe("test-token-hash");
      expect(url.searchParams.get("type")).toBe(type);
    });
  });
});
