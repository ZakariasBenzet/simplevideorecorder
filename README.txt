# Browser Video Recorder

Open `index.html` from a local web server (recommended) or host it on HTTPS.

Features:
- Camera + microphone recording
- Pause/resume
- Stop and automatic download
- Optional, configurable recording countdown
- Recording timer and live file-size indicator
- Mirror webcam switch and a compact 10-step microphone level meter
- Inline microphone-silence warning (no browser alert popups)
- Custom-value video options: background blur, brightness/contrast, saturation, sharpness, and zoom
- The enabled video options and webcam mirror are included in the saved recording
- Native MP4 recording when supported
- WebM recording + local FFmpeg.wasm conversion to MP4 when native MP4 is unavailable
- Camera and microphone selection
- Local processing; no recording is uploaded to a server

Files:
- `index.html` — page structure
- `style.css` — lightweight interface styling
- `recorder.js` — recording, audio-meter, countdown, and control logic

For local testing:
  python3 -m http.server 8000

Then open:
  http://localhost:8000

USE OF THIS PRODUCT IS AT YOUR OWN RISK. 
