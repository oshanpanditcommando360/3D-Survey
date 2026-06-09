# RunPod Launch Checklist

Use this when creating the reconstruction worker pod.

## Pod

- Image: `opendronemap/nodeodm:gpu`
- GPU: NVIDIA GPU, RTX 3090 or better is fine
- Expose HTTP port: `3000`
- Attach network volume for persistent ODM task data
- Keep the pod running as the NodeODM service, not as a generic Ubuntu shell

## Backend Environment

Set the app backend to the RunPod HTTP endpoint:

```env
NODEODM_URL="https://<runpod-port-3000-url>"
STORAGE_DIR="storage"
```

Install `ffmpeg` on the backend host if the backend will receive videos from the phone scanner.

## Validation

From the app repo:

```bash
npm run check:nodeodm
```

Expected result:

```json
{
  "ok": true
}
```

Then start the app:

```bash
npm run dev
```

Open **Scan a Property**, record a slow walkaround, tap **Survey Done**, and check **View Scans** after processing completes.

## Why the Existing SSH Pod Cannot Be Reused Directly

The shared pod is a generic Ubuntu GPU container. It has GPU access, but it does not have Docker, NodeODM, Node, npm, ffmpeg, Apptainer, `/dev/fuse`, or `cap_sys_admin`. Because NodeODM's supported GPU deployment is the `opendronemap/nodeodm:gpu` container image, this pod needs to be replaced or recreated with that image instead of retrofitted from SSH.
