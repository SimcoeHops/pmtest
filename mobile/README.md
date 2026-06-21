# Helm — mobile (Expo / React Native)

A React Native + Expo client for the [Helm](../README.md) project & task manager,
built for **Expo SDK 54** (matches Expo Go 54.x from the App Store).

## Screens

- **Dashboard** — greeting, at-a-glance stats (overdue / due today / in progress /
  waiting / done this week), My Day focus list, "done today" list.
- **Tasks** — full task list with smart **quick capture**
  (`Renew SSL certs @Infra #security !high ^fri`) and Open / Due today / Overdue /
  Done filters. Tap to complete, long-press for status / My Day / promote / delete.
- **Projects** — color-coded cards with progress, drill-down to a project's tasks
  grouped by status, plus inline quick-add.
- **Board** — kanban columns (To do / In progress / Waiting on / Done); tap a card
  to move it.

## Configuration

The backend URL lives in [`src/api.ts`](./src/api.ts) as `API_BASE`. It currently
points at the hosted backend:

```ts
export const API_BASE = 'https://pmtest-production.up.railway.app';
```

To run against a computer on your LAN instead, set it to the `Network:` URL that
`node server.js` prints (e.g. `http://192.168.1.20:4321`).

## Authentication

The deployed backend is password-protected. On first launch the app shows an
**Unlock** screen — enter the same password you use on the website. The app
authenticates via the server's session cookie (`POST /api/login`) and securely
remembers the password with `expo-secure-store`, so it silently re-authenticates
whenever the session expires. "Sign out" (bottom of the Dashboard) clears it.

## Reminders & notifications

Each task's ⏰ reminder fires even when the app is closed, two ways:

- **On-device local notifications** — scheduled on the phone and reconciled on
  every refresh. These work in **Expo Go today** (incl. iOS).
- **Server push** (Expo Push API) — the backend fires reminders for times that
  arrive while the app was never opened. Minting an Expo push token requires a
  **dev build** on iOS (Expo Go can't), so this path activates once you build
  with EAS; until then the on-device path covers you.

The app reports its timezone to the server so push fires at the right
wall-clock. Tapping a reminder opens the Tasks tab.

## Run it

```sh
cd mobile
npm install --legacy-peer-deps

# Resolve the rest of the SDK-54-compatible versions:
npx expo install react react-native expo-router expo-status-bar expo-system-ui \
  react-native-gesture-handler react-native-safe-area-context react-native-screens \
  @react-navigation/native -- --legacy-peer-deps

npx expo start --tunnel
```

Scan the QR code with Expo Go on your iPhone.
