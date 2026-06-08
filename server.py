#!/usr/bin/env python3
import json
import mimetypes
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data" / "scans"
INDEX_PATH = DATA_DIR / "index.json"
LOCK = threading.Lock()


def ensure_storage():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not INDEX_PATH.exists():
        INDEX_PATH.write_text("[]\n", encoding="utf-8")


def read_index():
    ensure_storage()
    try:
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def write_index(records):
    ensure_storage()
    INDEX_PATH.write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")


def update_record(scan_id, **changes):
    with LOCK:
        records = read_index()
        for record in records:
            if record["id"] == scan_id:
                record.update(changes)
                break
        write_index(records)


def find_record(scan_id):
    with LOCK:
        for record in read_index():
            if record["id"] == scan_id:
                return record
    return None


def build_draft_model(scan):
    frames = scan.get("frames", [])
    summary = scan.get("summary", {})
    location = scan.get("location")
    coverage = int(summary.get("coverage") or min(100, len(frames) * 12))
    length = round(4.2 + min(len(frames), 16) * 0.13, 2)
    width = round(2.8 + coverage * 0.012, 2)
    wall_height = round(2.35 + min(coverage, 100) * 0.004, 2)
    roof_height = round(wall_height + 0.9, 2)

    x = length / 2
    z = width / 2
    y0 = -1
    y1 = wall_height - 1
    yr = roof_height - 1

    vertices = [
        [-x, y0, -z],
        [x, y0, -z],
        [x, y0, z],
        [-x, y0, z],
        [-x, y1, -z],
        [x, y1, -z],
        [x, y1, z],
        [-x, y1, z],
        [0, yr, -z],
        [0, yr, z],
    ]

    faces = [
        {"indexes": [0, 1, 2, 3], "color": "#202631"},
        {"indexes": [0, 4, 5, 1], "color": "#3b4657"},
        {"indexes": [1, 5, 6, 2], "color": "#2f3948"},
        {"indexes": [2, 6, 7, 3], "color": "#465366"},
        {"indexes": [3, 7, 4, 0], "color": "#26303d"},
        {"indexes": [4, 8, 5], "color": "#39d59f"},
        {"indexes": [7, 6, 9], "color": "#57a6ff"},
        {"indexes": [4, 7, 9, 8], "color": "#223141"},
        {"indexes": [5, 8, 9, 6], "color": "#1b2633"},
    ]

    placement = {
        "latitude": None,
        "longitude": None,
        "altitude": 0,
        "rotation": 0,
        "scale": 1,
        "accuracyLabel": "manual_required",
        "source": "manual_required",
    }
    if isinstance(location, dict) and location.get("latitude") is not None and location.get("longitude") is not None:
        placement = {
            "latitude": location.get("latitude"),
            "longitude": location.get("longitude"),
            "altitude": location.get("altitude") or 0,
            "rotation": frames[0].get("pose", {}).get("heading", 0) if frames else 0,
            "scale": 1,
            "accuracyLabel": "approximate_phone_gps",
            "source": "browser_geolocation",
            "horizontalAccuracyM": location.get("accuracy"),
        }

    return {
        "format": "draft-json-mesh",
        "target_export": "glb",
        "label": "Backend draft property model",
        "dimensions_m": {"length": length, "width": width, "height": roof_height},
        "quality": "good" if coverage >= 70 and len(frames) >= 6 else "draft",
        "placement": placement,
        "coverage": {
            "percent": coverage,
            "coveredCells": len(scan.get("coverageMap", [])),
        },
        "vertices": vertices,
        "faces": faces,
    }


def process_scan(scan_id):
    update_record(scan_id, status="processing", progress=35)
    time.sleep(0.7)
    update_record(scan_id, progress=70)
    scan_dir = DATA_DIR / scan_id
    scan = json.loads((scan_dir / "scan.json").read_text(encoding="utf-8"))
    model = build_draft_model(scan)
    (scan_dir / "model.json").write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    update_record(
        scan_id,
        status="complete",
        progress=100,
        model_url=f"/api/scans/{scan_id}/model",
        completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


class SiteMapperHandler(SimpleHTTPRequestHandler):
    server_version = "SiteMapperBackend/0.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self.write_json({"ok": True, "service": "sitemapper-backend"})
        if path == "/api/scans":
            return self.write_json({"scans": read_index()})
        if path.startswith("/api/scans/"):
            return self.handle_scan_get(path)
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/scans":
            return self.create_scan()
        self.write_json({"error": "Not found"}, status=404)

    def handle_scan_get(self, path):
        parts = path.strip("/").split("/")
        if len(parts) not in (3, 4):
            return self.write_json({"error": "Not found"}, status=404)
        scan_id = parts[2]
        record = find_record(scan_id)
        if not record:
            return self.write_json({"error": "Scan not found"}, status=404)
        if len(parts) == 3:
            return self.write_json(record)
        if parts[3] == "model":
            model_path = DATA_DIR / scan_id / "model.json"
            if not model_path.exists():
                return self.write_json({"error": "Model is not ready"}, status=409)
            return self.write_json(json.loads(model_path.read_text(encoding="utf-8")))
        return self.write_json({"error": "Not found"}, status=404)

    def create_scan(self):
        try:
            payload = self.read_json_body()
        except ValueError as error:
            return self.write_json({"error": str(error)}, status=400)

        frames = payload.get("frames")
        if not isinstance(frames, list) or not frames:
            return self.write_json({"error": "frames must be a non-empty array"}, status=400)

        scan_id = uuid.uuid4().hex[:12]
        scan_dir = DATA_DIR / scan_id
        scan_dir.mkdir(parents=True, exist_ok=True)

        scan = {
            "id": scan_id,
            "received_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "capture_mode": payload.get("captureMode", "web-prototype"),
            "location": payload.get("location"),
            "location_status": payload.get("locationStatus", "unknown"),
            "coverageMap": payload.get("coverageMap", []),
            "summary": payload.get("summary", {}),
            "frames": frames,
        }
        (scan_dir / "scan.json").write_text(json.dumps(scan, indent=2) + "\n", encoding="utf-8")

        record = {
            "id": scan_id,
            "status": "queued",
            "progress": 10,
            "frame_count": len(frames),
            "coverage": scan["summary"].get("coverage", 0),
            "capture_mode": scan["capture_mode"],
            "location_status": scan["location_status"],
            "created_at": scan["received_at"],
        }
        with LOCK:
            records = read_index()
            records.insert(0, record)
            write_index(records)

        threading.Thread(target=process_scan, args=(scan_id,), daemon=True).start()
        self.write_json(record, status=202)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise ValueError("Missing request body")
        if length > 35 * 1024 * 1024:
            raise ValueError("Scan package is too large for the local prototype")
        body = self.rfile.read(length)
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError("Invalid JSON body") from error

    def write_json(self, payload, status=200):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    ensure_storage()
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    server = ThreadingHTTPServer(("0.0.0.0", 4173), SiteMapperHandler)
    print("SiteMapper backend running at http://localhost:4173")
    server.serve_forever()


if __name__ == "__main__":
    main()
