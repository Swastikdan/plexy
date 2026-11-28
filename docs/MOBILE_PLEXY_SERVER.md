# Android and Plexy Server

Android keeps its on-device library and adds Plexy Server as a source in every
watching mode. The library source picker offers **All**, **This device**,
**Plexy Server**, and **Online** where the mode allows online. The app never
changes the server's library from the phone.

## Connect

1. Enable LAN access on the server and copy the HTTPS address it prints.
2. Install the server certificate as a user CA if Android has not trusted it
   yet. Open the address in a browser, download
   `/api/server/certificate`, then use **Settings → Security → Encryption &
   credentials → Install a certificate → CA certificate**.
3. In Plexy, open **Settings → Plexy Server** and enter the HTTPS address.
4. Sign in with a pairing code from **Settings → Devices** on the server, or
   with your username and password.
5. Open **Settings → Library source** and choose **All**, **Plexy Server**, or
   **This device**. The same source is available from onboarding.

The session is stored in the app's protected credential store and scoped to the
server ID and account. A revoked or expired session asks you to sign in again;
the saved address stays so device folders keep working offline.

## Sources and merging

- **All** combines device and server titles in Home, Library, and Search with
  a small server badge on server cards.
- **Plexy Server** shows only the server library. **This device** shows only
  the on-device library. **Online** switches to the TMDB/Vidy catalog.
- When the same title exists in both places, the device copy appears first.
  Its title page offers **Also on Plexy Server · Open server copy**.
- Search results include server titles and episodes.

## Playback

Server playback uses the original file through the authenticated stream
endpoint. Seeking uses HTTP byte ranges. Subtitles come from the server's track
list and are fetched with the device credential. Casting a server title is not
supported in this build; local titles still cast normally.

## Downloads

The download button on a server movie or episode fetches the original file at
its stored quality. Files are validated, moved into the **Plexy Downloads**
library folder, and scanned into the on-device catalog, so they play offline.
Downloads do not transcode and do not use a quality cap. Server and device
progress are stored separately.

## Troubleshooting

- **The address does not load:** use `https://` and the LAN port, not the
  loopback `localhost` address.
- **Certificate error:** install the server certificate as a user CA, then
  retry.
- **Server titles disappear:** the server is offline or the session was
  revoked. Device titles still work; use **Settings → Plexy Server → Retry**.
- **Different server at the same address:** Plexy refuses the saved session
  when the server ID changes. Sign in again.
- **Download fails:** check free storage and that the server can read the
  original file. Completed downloads stay in the device library.
