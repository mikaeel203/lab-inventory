"use client";

import { useEffect, useState } from "react";
import { Download, WifiOff } from "lucide-react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallApp() {
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    const update = () => setOffline(!navigator.onLine);
    const capture = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("online", update); window.addEventListener("offline", update); update();
    return () => { window.removeEventListener("beforeinstallprompt", capture); window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return <>{offline && <p className="message error" role="status"><WifiOff size={16} /> You’re offline. Reconnect before reading or changing inventory.</p>}
    {install ? <button className="text-button install" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}><Download size={15} /> Install app</button> : <span className="install-hint">Phone tip: add to your home screen from your browser menu.</span>}</>;
}
