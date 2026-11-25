import { ImageResponse } from "next/og";

export function renderIcon(pixels: number) {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: "#174c3c", borderRadius: pixels / 5 }}>
      <svg width={pixels * 0.625} height={pixels * 0.625} viewBox="0 0 100 100" fill="none">
        <path d="M36 15h28M40 15v27L20 77q-5 9 7 9h46q12 0 7-9L60 42V15" stroke="#eff5cd" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 65h36l10 17H22Z" fill="#c6d991" /><circle cx="45" cy="57" r="4" fill="#eff5cd" />
      </svg>
    </div>, { width: pixels, height: pixels },
  );
}
