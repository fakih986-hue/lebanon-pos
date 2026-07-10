Titan POS — App Icon Assets

Required files:
  titan-source.png  1024x1024 PNG  — source artwork (provide your Titan logo)
  icon.png          1024x1024 PNG  — generated from source (tray + macOS)
  icon.ico          Windows ICO     — generated from source (installer + taskbar)

How to generate production icons:
  1. Create or obtain a 1024x1024 square PNG of the Titan POS logo
     (transparent or black background, white/gold text + icon mark)
  2. Save it as titan-source.png in this directory
  3. Install helpers (one-time):  pnpm add -D sharp png-to-ico
  4. Run:                        node make-icons.mjs
  5. Outputs:
       assets/icon.png           (1024x1024 PNG — tray icon, macOS)
       assets/icon.ico           (multires ICO — installer, taskbar, window)
       apps/desktop/public/titan-logo.png  (512x512 PNG — in-app logo)

Until a professional Titan POS logo is provided, the current placeholder
icons will be used. The tray will use an empty (invisible) fallback icon.
