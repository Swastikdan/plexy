# App responsibilities

Mobile owns an independent device library and plays local files without an account.
It does not connect to the Plexy backend. Metadata and skip markers are optional
external lookups whose results are cached locally.

Desktop embeds the frontend and backend. Its **Run local server** checkbox controls
only its child backend process. With it disabled, the desktop keeps its bundled UI
and connects to another server through an API proxy. Chromium maintains server
cookies on their original origins; the proxy never forwards the local server's
cookies or bearer credentials to a different server.

The standalone backend ships the same browser UI as static files. `--no-ui` or
`PLEXY_NO_UI=1` disables serving those files. It keeps the API and backend services
running for desktop clients. There is no separate frontend release or UI process.
