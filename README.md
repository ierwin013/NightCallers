# Night Callers

A dark-themed daily production and performance dashboard for the Night Callers team.

Open `index.html` in a browser or publish the repository root with GitHub Pages. Dashboard changes are saved in the browser's local storage.

The initial goals, roster, metrics, and team records are seeded from `data.json`. They can be changed from the dashboard.

## Firebase setup

The app syncs through Firebase Realtime Database using `SYNC_URL` in `script.js`. Realtime Database rules must allow reads and writes on the `nightcallers` node, for example:

```json
{
  "rules": {
    "nightcallers": {
      ".read": true,
      ".write": true
    }
  }
}
```

These rules allow anyone to read and change the data. If your database URL differs (for example, it uses a regional `firebasedatabase.app` URL), update `SYNC_URL` accordingly.

To host the site on GitHub Pages, go to **Settings > Pages > Deploy from a branch** and select **main** and **/(root)**.
