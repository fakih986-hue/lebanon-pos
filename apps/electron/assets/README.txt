Icon files required in this directory:

  icon.png  — 256x256 PNG — used for the system tray at runtime
  icon.ico  — Windows ICO (multi-size: 16, 32, 48, 256) — used by electron-builder for the installer and taskbar

How to generate:
  1. Design a 256x256 PNG icon (or use any image editor)
  2. Save as icon.png in this directory
  3. Convert to ICO using https://convertio.co/png-ico/ or ImageMagick:
       magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
  4. Place icon.ico in this directory

Until real icons are added, the tray will use an empty (invisible) icon — the app
still works but the tray entry may be hard to see.
