# WoundMeasure AI — GitHub Pages Offline PWA

Upload ALL files in this folder to the ROOT of a new GitHub repository.

Files:
- index.html
- manifest.webmanifest
- service-worker.js
- offline.html
- icon-192.png
- icon-512.png
- .nojekyll
- google_apps_script.gs (for your Google Apps Script backend)

## GitHub Pages
1. Create a new GitHub repository.
2. Upload all files.
3. Commit changes.
4. Settings > Pages.
5. Source: Deploy from a branch.
6. Branch: main.
7. Folder: /(root).
8. Save.
9. Wait a few minutes.
10. Open: https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/

## Offline installation
1. Open the GitHub Pages site while online.
2. iPhone/iPad: Safari > Share > Add to Home Screen.
3. Android/Chrome: menu > Install app / Add to Home screen.
4. Open the installed app once while online.
5. Later the app shell can open offline.
6. Use Save Offline to store assessments locally.
7. When internet returns, use Sync Pending to Google Drive.

Google Drive synchronization always requires internet.
Some OCR / Word / PDF / Excel functions use external libraries; use them once online before depending on them offline.
