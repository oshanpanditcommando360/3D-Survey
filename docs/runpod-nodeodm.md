# RunPod NodeODM Worker

The current RunPod pod you shared has an RTX 3090 and `/workspace`, but it does not have Docker inside the running container. That is expected on RunPod: choose the container image for the pod itself.

## Recommended RunPod Pod Image

Use:

```text
opendronemap/nodeodm:gpu
```

Expose:

```text
3000/http
```

Attach the 30 GB network volume to persist ODM task data.

## App Environment

Set the backend to talk to the NodeODM endpoint:

```env
NODEODM_URL="http://<runpod-public-url-or-tunnel>:3000"
```

For local testing with Docker:

```bash
bash scripts/start-nodeodm-local.sh
NODEODM_URL="http://localhost:3000" npm run dev
```

## Flow

```text
Upload images/video
-> backend stores media under storage/scans/{scanId}
-> videos are converted to frames with ffmpeg
-> backend submits frames to NodeODM /task/new
-> backend polls /task/{uuid}/info
-> backend downloads textured_model.zip
-> backend extracts OBJ if present
-> MapLibre + Three.js places the generated model on the map
```

## Notes

- ODM performs best with many sharp overlapping photos.
- For video, record slowly; backend extracts one frame per second.
- If `NODEODM_URL` is unset, the backend completes with a draft model only.
