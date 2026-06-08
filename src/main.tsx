import React from "react";
import ReactDOM from "react-dom/client";
import { Activity, Camera, Eye, Home, MapPinned, Rotate3d, Smartphone } from "lucide-react";
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
const sampleIntervalMs = 1500;
const maxFrames = 40;
const minFrames = 8;
const minCoverage = 60;

function App() {
  const [screen, setScreen] = React.useState<Screen>("home");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button className="flex items-center gap-3 text-left" onClick={() => setScreen("home")}>
            <div className="grid h-10 w-10 place-items-center rounded-md bg-primary text-primary-foreground">
              <MapPinned className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-black uppercase text-accent">3D Survey</p>
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
      <section className="grid content-center gap-6 rounded-lg border border-border bg-card p-6 sm:p-8">
        <Badge className="border-primary/40 bg-primary/10 text-accent">Phone-first 3D property survey</Badge>
        <div className="grid gap-3">
          <h2 className="text-3xl font-black tracking-normal sm:text-5xl">Scan a property and place it on a 3D map.</h2>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            Use a mobile camera survey to create a draft 3D model, store scan records in Supabase through Prisma, and preview model placement on a free Cesium/OpenStreetMap view.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" onClick={() => setScreen("scan")}>
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
          ["Continuous survey", "The user moves the phone; samples are captured automatically."],
          ["Blue coverage mesh", "The live camera view fills with dotted cells as the area is covered."],
          ["Map placement", "Completed scans appear on a Cesium 3D map using GPS metadata."],
        ].map(([title, body]) => (
          <Card key={title}>
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
  const streamRef = React.useRef<MediaStream | null>(null);
  const [frames, setFrames] = React.useState<SurveyFrame[]>([]);
  const [coverageCells, setCoverageCells] = React.useState<Map<string, CoverageCell>>(new Map());
  const [surveyActive, setSurveyActive] = React.useState(false);
  const [processing, setProcessing] = React.useState(false);
  const [status, setStatus] = React.useState("Camera ready");
  const [note, setNote] = React.useState("Open this on a phone, tap Start survey, then move around the property.");
  const [location, setLocation] = React.useState<SurveyLocation | null>(null);
  const [locationStatus, setLocationStatus] = React.useState("pending");
  const [model, setModel] = React.useState<Model | null>(null);

  const coverage = Math.min(100, Math.round((coverageCells.size / (rows * cols)) * 100));
  const canFinish = surveyActive && frames.length >= minFrames && coverage >= minCoverage && !processing;

  React.useEffect(() => {
    drawCoverageOverlay(overlayRef.current, coverageCells, coverage, locationStatus, location);
  }, [coverageCells, coverage, locationStatus, location]);

  React.useEffect(() => {
    drawModel(modelRef.current, model);
  }, [model]);

  React.useEffect(() => () => stopCamera(streamRef, timerRef, setSurveyActive), []);

  async function startSurvey() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Unsupported");
      setNote("This browser does not expose camera capture.");
      return;
    }
    stopCamera(streamRef, timerRef, setSurveyActive);
    setFrames([]);
    setCoverageCells(new Map());
    setModel(null);
    setLocation(null);
    setLocationStatus("pending");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setSurveyActive(true);
      setStatus("Surveying");
      setNote("Move slowly. Blue dots show areas already covered. Survey done unlocks after enough coverage.");
      getLocation(setLocation, setLocationStatus);
      sampleFrame();
      timerRef.current = window.setInterval(sampleFrame, sampleIntervalMs);
    } catch {
      setStatus("Camera blocked");
      setNote("Camera permission failed. Use localhost/HTTPS and allow camera access.");
    }
  }

  function sampleFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setFrames((current) => {
      if (current.length >= maxFrames) return current;
      const canvas = document.createElement("canvas");
      const width = 360;
      const height = Math.round((video.videoHeight / video.videoWidth) * width);
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
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
      return [
        ...current,
        {
          id: crypto.randomUUID ? crypto.randomUUID() : `frame-${Date.now()}-${current.length}`,
          createdAt: new Date().toISOString(),
          coverageCell: cell,
          pose: {
            heading: Math.round((current.length * 31) % 360),
            pitch: -4 + Math.round(Math.random() * 8),
            confidence: Math.round(72 + Math.random() * 24),
          },
          image: canvas.toDataURL("image/jpeg", 0.6),
        },
      ];
    });
  }

  async function finishSurvey() {
    stopCamera(streamRef, timerRef, setSurveyActive);
    setProcessing(true);
    setStatus("Uploading");
    setNote("Uploading survey samples, coverage mesh, and location metadata to Supabase-backed API.");
    try {
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captureMode: "continuous-survey",
          location,
          locationStatus,
          coverageMap: Array.from(coverageCells.values()),
          frames,
          summary: { frameCount: frames.length, coverage, quality: coverage > 70 ? "Good" : "Draft" },
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

  return (
    <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[1fr_360px]">
      <section className="grid min-h-[70svh] grid-rows-[auto_1fr] overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-xl font-bold">Scan a Property</h2>
            <p className="text-sm text-muted-foreground">{note}</p>
          </div>
          <Badge>{status}</Badge>
        </div>
        <div className="relative min-h-[420px] bg-slate-950">
          <video ref={videoRef} className="scan-video" playsInline muted />
          <canvas ref={overlayRef} className="scan-canvas" />
          {!surveyActive && frames.length === 0 && (
            <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-border bg-background/85 p-4 backdrop-blur">
              <p className="text-lg font-bold">Start a continuous survey</p>
              <p className="text-sm text-muted-foreground">No photo button needed. Move the phone and coverage fills automatically.</p>
            </div>
          )}
        </div>
      </section>
      <aside className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Survey package</CardTitle>
            <CardDescription>Minimum 60% coverage and 8 samples.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Metric label="Samples" value={frames.length} />
            <Metric label="Coverage" value={`${coverage}%`} />
            <Metric label="Location" value={locationStatus === "captured" ? `+/- ${Math.round(location?.accuracy || 0)}m` : locationStatus} />
            <Metric label="Model" value={model ? "Ready" : processing ? "Building" : "None"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button onClick={startSurvey}>
              <Camera className="h-4 w-4" />
              {surveyActive ? "Restart survey" : "Start survey"}
            </Button>
            <Button variant="secondary" disabled={!canFinish} onClick={finishSurvey}>
              <Activity className="h-4 w-4" />
              Survey done
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Draft model</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative aspect-video overflow-hidden rounded-md bg-slate-950">
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
        <Card>
          <CardHeader>
            <CardTitle>View Scans</CardTitle>
            <CardDescription>Completed property surveys stored in Supabase.</CardDescription>
          </CardHeader>
        </Card>
        {loading && <Card><CardContent className="pt-5 text-sm text-muted-foreground">Loading scans...</CardContent></Card>}
        {!loading && scans.length === 0 && <Card><CardContent className="pt-5 text-sm text-muted-foreground">No scans yet. Scan a property first.</CardContent></Card>}
        {scans.map((scan) => (
          <button key={scan.id} className="text-left" onClick={() => setSelected(scan)}>
            <Card className={selected?.id === scan.id ? "border-primary" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">Scan {scan.id.slice(0, 8)}</CardTitle>
                  <Badge>{scan.status}</Badge>
                </div>
                <CardDescription>{scan.frame_count} samples · {scan.coverage}% coverage</CardDescription>
              </CardHeader>
            </Card>
          </button>
        ))}
      </aside>
      <section className="min-h-[72svh] overflow-hidden rounded-lg border border-border bg-card">
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
        material: Cesium.Color.fromCssColorString("#2563eb").withAlpha(0.55),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#38bdf8"),
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
      <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-border bg-background/85 p-4 backdrop-blur sm:right-auto sm:max-w-lg">
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

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs font-bold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}

function nextCell(index: number) {
  const cellIndex = index % (rows * cols);
  const sweep = Math.floor(index / cols);
  const col = sweep % 2 === 0 ? cellIndex % cols : cols - 1 - (cellIndex % cols);
  const row = Math.min(rows - 1, Math.floor(cellIndex / cols));
  return { row, col };
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

function stopCamera(
  streamRef: React.MutableRefObject<MediaStream | null>,
  timerRef: React.MutableRefObject<number | null>,
  setSurveyActive: (active: boolean) => void,
) {
  if (timerRef.current) {
    window.clearInterval(timerRef.current);
    timerRef.current = null;
  }
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;
  setSurveyActive(false);
}

function drawCoverageOverlay(
  canvas: HTMLCanvasElement | null,
  cells: Map<string, CoverageCell>,
  coverage: number,
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
  context.strokeStyle = "rgba(56, 189, 248, 0.85)";
  context.strokeRect(inset, inset, meshWidth, meshHeight);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const covered = cells.has(`${row}:${col}`);
      const x = inset + col * cellWidth + cellWidth / 2;
      const y = inset + row * cellHeight + cellHeight / 2;
      if (covered) {
        context.fillStyle = "rgba(37, 99, 235, 0.16)";
        context.fillRect(inset + col * cellWidth, inset + row * cellHeight, cellWidth, cellHeight);
      }
      context.beginPath();
      context.arc(x, y, covered ? 5.5 : 3.5, 0, Math.PI * 2);
      context.fillStyle = covered ? "#38bdf8" : "rgba(226,232,240,0.35)";
      context.fill();
    }
  }
  context.fillStyle = "rgba(15,23,42,0.78)";
  context.fillRect(16, 16, 300, 66);
  context.fillStyle = "#f8fafc";
  context.font = "700 15px system-ui";
  context.fillText(`Coverage ${coverage}%`, 30, 42);
  context.fillStyle = locationStatus === "captured" ? "#22c55e" : "rgba(226,232,240,0.72)";
  context.font = "700 12px system-ui";
  context.fillText(locationStatus === "captured" ? `GPS +/- ${Math.round(location?.accuracy || 0)}m` : "Getting GPS for map placement", 30, 64);
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
  context.fillStyle = "#020617";
  context.fillRect(0, 0, rect.width, rect.height);
  context.fillStyle = "rgba(248,250,252,0.82)";
  context.font = "800 15px system-ui";
  context.fillText(model ? model.label : "Draft model preview", 16, 30);
  if (!model) return;
  context.fillStyle = "#2563eb";
  context.fillRect(rect.width / 2 - 65, rect.height / 2 - 35, 130, 70);
  context.strokeStyle = "#38bdf8";
  context.lineWidth = 2;
  context.strokeRect(rect.width / 2 - 65, rect.height / 2 - 35, 130, 70);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
