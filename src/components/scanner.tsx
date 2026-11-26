"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Camera, ScanLine } from "lucide-react";

export function Scanner({ onScan }: { onScan: (value: string, format: string) => void }) {
  const id = `scanner-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  const [manualType, setManualType] = useState("MANUAL");
  const callback = useRef(onScan);
  callback.current = onScan;
  useEffect(() => {
    if (!camera) return;
    let disposed = false;
    let detected = false;
    let scanner: import("html5-qrcode").Html5Qrcode | undefined;
    let start: Promise<unknown> | undefined;
    void import("html5-qrcode").then(({ Html5Qrcode, Html5QrcodeSupportedFormats }) => {
      if (disposed) return;
      scanner = new Html5Qrcode(id, { verbose: false, formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.DATA_MATRIX,
        Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.CODE_128,
      ] });
      start = scanner.start({ facingMode: "environment" }, { fps: 10 }, (value, result) => {
        if (disposed || detected) return;
        detected = true;
        callback.current(value, result.result.format?.formatName ?? "UNKNOWN");
      }, () => {});
      return start;
    }).catch(() => {
      if (!disposed) setError("Camera unavailable. Allow camera access and use HTTPS, or enter the code below.");
    });
    return () => {
      disposed = true;
      void Promise.resolve(start).catch(() => {}).then(async () => {
        if (scanner?.isScanning) await scanner.stop();
        scanner?.clear();
      }).catch(() => {});
    };
  }, [camera, id]);

  function manualSubmit(event: FormEvent) {
    event.preventDefault();
    if (manual.trim()) onScan(manual.trim(), manualType);
  }

  return <div className="form-stack">
    <p className="muted">Scan the product’s barcode or QR code. You’ll review the name and quantity before saving.</p>
    {!camera && <button className="camera-start" onClick={() => { setError(""); setCamera(true); }}><Camera size={36} /><strong>Open camera</strong><span>Use your phone’s rear camera</span></button>}
    <div id={id} className={camera ? "camera-feed" : ""} />
    {camera && <p className="muted camera-hint"><ScanLine size={18} /> Hold the label steady and keep the whole code in view.</p>}
    {error && <p role="alert" className="message error">{error}</p>}
    <form className="form-stack" onSubmit={manualSubmit}>
      <label>Code type<select value={manualType} onChange={event => { setManualType(event.target.value); setManual(""); }}><option value="MANUAL">Barcode / QR / product URL</option><option value="CATALOGUE_NUMBER">Catalogue number</option></select></label>
      <label>{manualType === "CATALOGUE_NUMBER" ? "Enter catalogue number" : "Or enter barcode / product URL"}<input value={manual} onChange={event => setManual(event.target.value)} maxLength={manualType === "CATALOGUE_NUMBER" ? 120 : 2048} required placeholder={manualType === "CATALOGUE_NUMBER" ? "e.g. T1503-1KG" : "Barcode number or https://…"} /></label>
      <p className="field-hint">We check your lab first, then the shared product catalogue. Printed catalogue numbers can be entered here; reading them from photos is not available yet.</p>
      <button className="button secondary" type="submit">Use this code</button>
    </form>
  </div>;
}
