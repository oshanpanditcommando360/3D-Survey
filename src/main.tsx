import React from "react";
import ReactDOM from "react-dom/client";
import { Activity, Camera, Eye, Home, MapPinned, Rotate3d, Smartphone, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import "./index.css";

type Screen = "home" | "scan" | "scans";
type ScanRecord = {
  id: string;
  status: "queued" | "processing" | "complete" | "failed";
  progress: number;
  frame_count: number;
  coverage: number;
  capture_mode: string;
  location_status: string;
  latitude: number | null;
  longitude: number | null;
  model_url: string | null;
  created_at: string;
  completed_at: string | null;
};
type SurveyFrame = {
  id: string;
  createdAt: string;
  coverageCell: { row: number; col: number };
  pose: { heading: number; pitch: number; confidence: number };
  sharpness: number;
  image: string;
};
type CoverageCell = { row: number; col: number; confidence: number; sampledAt: string };
type SurveyLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  capturedAt: string;
};
type Orientation = { alpha: number | null; beta: number | null; gamma: number | null };
type Model = {
  label: string;
  dimensions_m?: { length: number; width: number; height: number };
  placement?: {
    latitude: number | null;
    longitude: number | null;
    altitude: number;
    rotation: number;
    scale: number;
    accuracyLabel: string;
    horizontalAccuracyM?: number;
  };
  vertices: number[][];
  faces: { indexes: number[]; color: string }[];
};

const rows = 5;
const cols = 8;
const captureIntervalMs = 800;
const maxFrames = 120;
const minFrames = 30;
const recommendedFrames = 80;
const frameWidth = 960;
const frameQuality = 0.7;
const blurThreshold = 11;

function App() {
  const [screen, setScreen] = React.useState<Screen>("home");

  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button className="flex items-center gap-3 text-left" onClick={() => setScreen("home")}>
            <div className="grid h-10 w-10 place-items-center rounded-md cta-gradient">
              <MapPinned className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">3D Survey</p>
              <h1 className="text-lg font-semibold sm:text-xl">Property mapping platform</h1>
            </div>
          </button>
          <nav className="hidden items-center gap-2 sm:flex">
            <Button variant={screen === "home" ? "secondary" : "ghost"} onClick={() => setScreen("home")}>
              <Home className="h-4 w-4" />
              Home
            </Button>
            <Button variant={screen === "scan" ? "secondary" : "ghost"} onClick={() => setScreen("scan")}>
              <Camera className="h-4 w-4" />
              Scan
            </Button>
            <Button variant={screen === "scans" ? "secondary" : "ghost"} onClick={() => setScreen("scans")}>
              <Eye className="h-4 w-4" />
              View
            </Button>
          </nav>
        </div>
      </header>

      {screen === "home" && <HomeScreen setScreen={setScreen} />}
      {screen === "scan" && <ScanProperty />}
      {screen === "scans" && <ViewScans />}
    </div>
  );
}

function HomeScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="hero-gradient soft-card grid content-center gap-6 rounded-2xl border border-border p-6 sm:p-8">
        <Badge className="border-primary/30 bg-primary/10 text-primary">Phone-first 3D property survey</Badge>
        <div className="grid gap-3">
          <h2 className="text-3xl font-black tracking-tight sm:text-5xl">
            Record a property and place it on a 3D map.
          </h2>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            Slowly film the building with your phone. The app pulls sharp, overlapping frames automatically,
            stores the scan in Supabase, and previews the result on a free Cesium / OpenStreetMap view.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" className="cta-gradient" onClick={() => setScreen("scan")}>
            <Smartphone className="h-5 w-5" />
            Scan a Property
          </Button>
          <Button size="lg" variant="outline" onClick={() => setScreen("scans")}>
            <Rotate3d className="h-5 w-5" />
            View Scans
          </Button>
        </div>
      </section>
      <section className="grid gap-4">
        {[
          ["Film, don't snap", "Just record a slow walk-around. Frames are captured for you—no photo button."],
          ["Sharp frames only", "Blurry frames are skipped so the 3D reconstruction has clean input."],
          ["Map placement", "Completed scans appear on a Cesium 3D map using the captured GPS location."],
        ].map(([title, body]) => (
          <Card key={title} className="soft-card">
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </main>
  );
}

function ScanProperty() {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const overlayRef = React.useRef<HTMLCanvasElement | null>(null);
  const modelRef = React.useRef<HTMLCanvasElement | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const clockRef = React.useRef<number | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const orientationRef = React.useRef<Orientation>({ alpha: null, beta: null, gamma: null });
  const orientationHandlerRef = React.useRef<((event: DeviceOrientationEvent) => void) | null>(null);
  const skipRef = React.useRef(0);
  const startTimeRef = React.useRef(0);
  const [frames, setFrames] = React.useState<SurveyFrame[]>([]);
  const [coverageCells, setCoverageCells] = React.useState<Map<string, CoverageCell>>(new Map());
  const [recording, setRecording] = React.useState(false);
  const [processing, setProcessing] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [skipped, setSkipped] = React.useState(0);
  const [status, setStatus] = React.useState("Camera ready");
  const [note, setNote] = React.useState("Open on a phone, tap Start recording, then walk slowly around the property.");
  const [location, setLocation] = React.useState<SurveyLocation | null>(null);
  const [locationStatus, setLocationStatus] = React.useState("pending");
  const [model, setModel] = React.useState<Model | null>(null);

  const coverage = Math.min(100, Math.round((coverageCells.size / (rows * cols)) * 100));
  const canFinish = recording && frames.length >= minFrames && !processing;

  React.useEffect(() => {
    drawCoverageOverlay(overlayRef.current, coverageCells, coverage, frames.length, locationStatus, location);
  }, [coverageCells, coverage, frames.length, locationStatus, location]);

  React.useEffect(() => {
    drawModel(modelRef.current, model);
  }, [model]);

  React.useEffect(
    () => () => teardown(streamRef, timerRef, clockRef, orientationHandlerRef, setRecording),
    [],
  );

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Unsupported");
      setNote("This browser does not expose camera capture.");
      return;
    }
    teardown(streamRef, timerRef, clockRef, orientationHandlerRef, setRecording);
    setFrames([]);
    setCoverageCells(new Map());
    setModel(null);
    setLocation(null);
    setLocationStatus("pending");
    setElapsed(0);
    setSkipped(0);
    skipRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setRecording(true);
      setStatus("Recording");
      setNote("Walk slowly. Keep the building in frame and circle it fully. Capture every side and a few heights.");
      startTimeRef.current = Date.now();
      getLocation(setLocation, setLocationStatus);
      startOrientation(orientationRef, orientationHandlerRef);
      captureFrame();
      timerRef.current = window.setInterval(captureFrame, captureIntervalMs);
      clockRef.current = window.setInterval(() => {
        setElapsed(Math.round((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch {
      setStatus("Camera blocked");
      setNote("Camera permission failed. Use localhost / HTTPS and allow camera access.");
    }
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const score = focusScore(video);
    if (score < blurThreshold && skipRef.current < 4) {
      skipRef.current += 1;
      setSkipped((value) => value + 1);
      return;
    }
    skipRef.current = 0;

    const canvas = document.createElement("canvas");
    const width = frameWidth;
    const height = Math.round((video.videoHeight / video.videoWidth) * width);
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    const image = canvas.toDataURL("image/jpeg", frameQuality);
    const orientation = orientationRef.current;

    setFrames((current) => {
      if (current.length >= maxFrames) return current;
      const cell = nextCell(current.length);
      setCoverageCells((existing) => {
        const next = new Map(existing);
        next.set(`${cell.row}:${cell.col}`, {
          ...cell,
          confidence: Math.min(0.98, 0.62 + current.length * 0.012),
          sampledAt: new Date().toISOString(),
        });
        return next;
      });
      const heading = orientation.alpha != null ? Math.round((360 - orientation.alpha) % 360) : Math.round((current.length * 31) % 360);
      const pitch = orientation.beta != null ? Math.round(orientation.beta - 90) : 0;
      return [
        ...current,
        {
          id: crypto.randomUUID ? crypto.randomUUID() : `frame-${Date.now()}-${current.length}`,
          createdAt: new Date().toISOString(),
          coverageCell: cell,
          pose: {
            heading,
            pitch,
            confidence: Math.max(40, Math.min(99, Math.round(score))),
          },
          sharpness: Math.round(score),
          image,
        },
      ];
    });
  }

  async function finishRecording() {
    teardown(streamRef, timerRef, clockRef, orientationHandlerRef, setRecording);
    setProcessing(true);
    setStatus("Uploading");
    setNote("Uploading captured frames, coverage map, and GPS location to the Supabase-backed API.");
    try {
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captureMode: "video-walkaround",
          location,
          locationStatus,
          coverageMap: Array.from(coverageCells.values()),
          frames,
          summary: {
            frameCount: frames.length,
            coverage,
            durationSec: elapsed,
            quality: frames.length >= recommendedFrames ? "Good" : "Draft",
          },
        }),
      });
      if (!response.ok) throw new Error("Scan upload failed");
      const scan = await response.json();
      setStatus("Processing");
      const ready = await waitForScan(scan.id);
      const modelResponse = await fetch(`/api/scans/${ready.id}/model`);
      if (!modelResponse.ok) throw new Error("Model is not ready");
      setModel(await modelResponse.json());
      setStatus("Model ready");
      setNote("Model generated. View Scans shows it on the 3D map.");
    } catch (error) {
      setStatus("Backend error");
      setNote(error instanceof Error ? error.message : "Backend upload or processing failed.");
    } finally {
      setProcessing(false);
    }
  }

  const enough = frames.length >= recommendedFrames;

  return (
    <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[1fr_360px]">
      <section className="soft-card grid min-h-[70svh] grid-rows-[auto_1fr] overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-xl font-bold">Scan a Property</h2>
            <p className="text-sm text-muted-foreground">{note}</p>
          </div>
          <Badge className={recording ? "border-primary/40 bg-primary/10 text-primary" : ""}>{status}</Badge>
        </div>
        <div className="stage-gradient relative min-h-[420px]">
          <video ref={videoRef} className="scan-video" playsInline muted />
          <canvas ref={overlayRef} className="scan-canvas" />
          {recording && (
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 backdrop-blur">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              <span className="text-sm font-semibold text-white">REC {formatTime(elapsed)}</span>
            </div>
          )}
          {!recording && frames.length === 0 && (
            <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-white/15 bg-black/55 p-4 text-white backdrop-blur">
              <p className="text-lg font-bold">Record a slow walk-around</p>
              <p className="text-sm text-white/75">
                No photo button. Just film the property and the app keeps the sharp frames automatically.
              </p>
            </div>
          )}
        </div>
      </section>
      <aside className="grid gap-4">
        <Card className="soft-card">
          <CardHeader>
            <CardTitle>Capture progress</CardTitle>
            <CardDescription>Aim for {recommendedFrames}+ sharp frames, all sides covered.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Metric label="Frames" value={`${frames.length}/${recommendedFrames}`} highlight={enough} />
            <Metric label="Coverage" value={`${coverage}%`} />
            <Metric label="Skipped blur" value={skipped} />
            <Metric label="Location" value={locationStatus === "captured" ? `±${Math.round(location?.accuracy || 0)}m` : locationStatus} />
          </CardContent>
        </Card>
        <Card className="soft-card">
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button className="cta-gradient" onClick={startRecording}>
              <Video className="h-4 w-4" />
              {recording ? "Restart recording" : "Start recording"}
            </Button>
            <Button variant="secondary" disabled={!canFinish} onClick={finishRecording}>
              <Activity className="h-4 w-4" />
              Stop &amp; build model
            </Button>
            {recording && frames.length < minFrames && (
              <p className="text-xs text-muted-foreground">
                Keep filming — capture at least {minFrames} frames before building.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="soft-card">
          <CardHeader>
            <CardTitle>Draft model</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-[#faf7f2]">
              <canvas ref={modelRef} className="model-canvas" />
            </div>
          </CardContent>
        </Card>
      </aside>
    </main>
  );
}

function ViewScans() {
  const [scans, setScans] = React.useState<ScanRecord[]>([]);
  const [selected, setSelected] = React.useState<ScanRecord | null>(null);
  const [model, setModel] = React.useState<Model | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch("/api/scans")
      .then((res) => res.json())
      .then((data) => {
        const records = data.scans || [];
        setScans(records);
        setSelected(records.find((scan: ScanRecord) => scan.status === "complete") || records[0] || null);
      })
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    if (!selected?.model_url) {
      setModel(null);
      return;
    }
    fetch(selected.model_url)
      .then((res) => res.json())
      .then(setModel)
      .catch(() => setModel(null));
  }, [selected]);

  return (
    <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[360px_1fr]">
      <aside className="grid gap-3">
        <Card className="soft-card">
          <CardHeader>
            <CardTitle>View Scans</CardTitle>
            <CardDescription>Completed property surveys stored in Supabase.</CardDescription>
          </CardHeader>
        </Card>
        {loading && <Card className="soft-card"><CardContent className="pt-5 text-sm text-muted-foreground">Loading scans...</CardContent></Card>}
        {!loading && scans.length === 0 && <Card className="soft-card"><CardContent className="pt-5 text-sm text-muted-foreground">No scans yet. Scan a property first.</CardContent></Card>}
        {scans.map((scan) => (
          <button key={scan.id} className="text-left" onClick={() => setSelected(scan)}>
            <Card className={`soft-card ${selected?.id === scan.id ? "border-primary" : ""}`}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">Scan {scan.id.slice(0, 8)}</CardTitle>
                  <Badge className={scan.status === "complete" ? "border-primary/40 bg-primary/10 text-primary" : ""}>{scan.status}</Badge>
                </div>
                <CardDescription>{scan.frame_count} frames · {scan.coverage}% coverage</CardDescription>
              </CardHeader>
            </Card>
          </button>
        ))}
      </aside>
      <section className="soft-card min-h-[72svh] overflow-hidden rounded-2xl border border-border bg-card">
        <CesiumMap model={model} selected={selected} />
      </section>
    </main>
  );
}

function CesiumMap({ model, selected }: { model: Model | null; selected: ScanRecord | null }) {
  const mapRef = React.useRef<HTMLDivElement | null>(null);
  const viewerRef = React.useRef<any>(null);
  const entityRef = React.useRef<any>(null);

  React.useEffect(() => {
    if (!mapRef.current || viewerRef.current || !window.Cesium) return;
    const Cesium = window.Cesium;
    viewerRef.current = new Cesium.Viewer(mapRef.current, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      imageryProvider: new Cesium.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }),
    });
  }, []);

  React.useEffect(() => {
    const Cesium = window.Cesium;
    const viewer = viewerRef.current;
    const placement = model?.placement;
    if (!Cesium || !viewer || !placement?.latitude || !placement.longitude) return;
    if (entityRef.current) viewer.entities.remove(entityRef.current);
    const dims = model?.dimensions_m || { length: 5, width: 4, height: 3 };
    const center = Cesium.Cartesian3.fromDegrees(placement.longitude, placement.latitude, (placement.altitude || 0) + dims.height / 2);
    entityRef.current = viewer.entities.add({
      name: "Survey model placement",
      position: center,
      orientation: Cesium.Transforms.headingPitchRollQuaternion(
        center,
        new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(placement.rotation || 0), 0, 0),
      ),
      box: {
        dimensions: new Cesium.Cartesian3(dims.width, dims.length, dims.height),
        material: Cesium.Color.fromCssColorString("#dc2626").withAlpha(0.55),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#ef4444"),
      },
    });
    viewer.flyTo(entityRef.current, {
      duration: 0.8,
      offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(25), Cesium.Math.toRadians(-35), 90),
    });
  }, [model]);

  return (
    <div className="relative h-full min-h-[72svh]">
      <div ref={mapRef} className="cesium-map" />
      <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-border bg-background/85 p-4 backdrop-blur sm:right-auto sm:max-w-lg">
        <p className="font-semibold">{selected ? `Scan ${selected.id.slice(0, 8)}` : "No scan selected"}</p>
        <p className="text-sm text-muted-foreground">
          {model?.placement?.latitude
            ? `Placed from phone GPS at ${model.placement.latitude.toFixed(5)}, ${model.placement.longitude?.toFixed(5)}`
            : "Select a completed scan with GPS placement to view it on the map."}
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? "border-primary/40 bg-primary/5" : "border-border bg-background"}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-black ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function nextCell(index: number) {
  const cellIndex = index % (rows * cols);
  const sweep = Math.floor(index / cols);
  const col = sweep % 2 === 0 ? cellIndex % cols : cols - 1 - (cellIndex % cols);
  const row = Math.min(rows - 1, Math.floor(cellIndex / cols));
  return { row, col };
}

// Cheap focus measure: variance of a Laplacian on a small grayscale frame.
// Higher = sharper. Used to skip obviously blurry frames.
function focusScore(video: HTMLVideoElement): number {
  const w = 128;
  const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return blurThreshold;
  ctx.drawImage(video, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  if (n === 0) return blurThreshold;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function startOrientation(
  orientationRef: React.MutableRefObject<Orientation>,
  handlerRef: React.MutableRefObject<((event: DeviceOrientationEvent) => void) | null>,
) {
  const attach = () => {
    const handler = (event: DeviceOrientationEvent) => {
      orientationRef.current = { alpha: event.alpha, beta: event.beta, gamma: event.gamma };
    };
    handlerRef.current = handler;
    window.addEventListener("deviceorientation", handler, true);
  };
  const anyOrientation = window.DeviceOrientationEvent as any;
  if (anyOrientation && typeof anyOrientation.requestPermission === "function") {
    anyOrientation
      .requestPermission()
      .then((state: string) => {
        if (state === "granted") attach();
      })
      .catch(() => undefined);
  } else if (window.DeviceOrientationEvent) {
    attach();
  }
}

function getLocation(
  setLocation: (location: SurveyLocation | null) => void,
  setLocationStatus: (status: string) => void,
) {
  if (!navigator.geolocation) {
    setLocationStatus("unsupported");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        altitudeAccuracy: position.coords.altitudeAccuracy,
        capturedAt: new Date().toISOString(),
      });
      setLocationStatus("captured");
    },
    () => setLocationStatus("denied"),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
  );
}

async function waitForScan(scanId: string): Promise<ScanRecord> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`/api/scans/${scanId}`);
    if (!response.ok) throw new Error("Could not read scan status");
    const scan = await response.json();
    if (scan.status === "complete") return scan;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Model processing timed out");
}

function teardown(
  streamRef: React.MutableRefObject<MediaStream | null>,
  timerRef: React.MutableRefObject<number | null>,
  clockRef: React.MutableRefObject<number | null>,
  handlerRef: React.MutableRefObject<((event: DeviceOrientationEvent) => void) | null>,
  setRecording: (active: boolean) => void,
) {
  if (timerRef.current) {
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }
  if (clockRef.current) {
    window.clearInterval(clockRef.current);
    clockRef.current = null;
  }
  if (handlerRef.current) {
    window.removeEventListener("deviceorientation", handlerRef.current, true);
    handlerRef.current = null;
  }
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;
  setRecording(false);
}

function drawCoverageOverlay(
  canvas: HTMLCanvasElement | null,
  cells: Map<string, CoverageCell>,
  coverage: number,
  frameCount: number,
  locationStatus: string,
  location: SurveyLocation | null,
) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const inset = Math.min(rect.width, rect.height) * 0.08;
  const meshWidth = rect.width - inset * 2;
  const meshHeight = rect.height - inset * 2;
  const cellWidth = meshWidth / cols;
  const cellHeight = meshHeight / rows;
  context.strokeStyle = "rgba(239, 68, 68, 0.8)";
  context.strokeRect(inset, inset, meshWidth, meshHeight);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const covered = cells.has(`${row}:${col}`);
      const x = inset + col * cellWidth + cellWidth / 2;
      const y = inset + row * cellHeight + cellHeight / 2;
      if (covered) {
        context.fillStyle = "rgba(220, 38, 38, 0.16)";
        context.fillRect(inset + col * cellWidth, inset + row * cellHeight, cellWidth, cellHeight);
      }
      context.beginPath();
      context.arc(x, y, covered ? 5.5 : 3.5, 0, Math.PI * 2);
      context.fillStyle = covered ? "#ef4444" : "rgba(255,255,255,0.4)";
      context.fill();
    }
  }
  context.fillStyle = "rgba(10,10,10,0.55)";
  context.fillRect(16, 16, 320, 66);
  context.fillStyle = "#ffffff";
  context.font = "700 15px system-ui";
  context.fillText(`Coverage ${coverage}%  ·  ${frameCount} frames`, 30, 42);
  context.fillStyle = locationStatus === "captured" ? "#34d399" : "rgba(255,255,255,0.75)";
  context.font = "700 12px system-ui";
  context.fillText(
    locationStatus === "captured" ? `GPS ±${Math.round(location?.accuracy || 0)}m` : "Getting GPS for map placement",
    30,
    64,
  );
}

function drawModel(canvas: HTMLCanvasElement | null, model: Model | null) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const gradient = context.createLinearGradient(0, 0, 0, rect.height);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(1, "#f4ece2");
  context.fillStyle = gradient;
  context.fillRect(0, 0, rect.width, rect.height);
  context.fillStyle = "rgba(26,22,17,0.85)";
  context.font = "800 15px system-ui";
  context.fillText(model ? model.label : "Draft model preview", 16, 30);
  if (!model) return;
  context.fillStyle = "rgba(220,38,38,0.85)";
  context.fillRect(rect.width / 2 - 65, rect.height / 2 - 35, 130, 70);
  context.strokeStyle = "#ef4444";
  context.lineWidth = 2;
  context.strokeRect(rect.width / 2 - 65, rect.height / 2 - 35, 130, 70);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
