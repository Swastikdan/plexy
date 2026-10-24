import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions, app } from "electron";
import path from "node:path";

export function setupApplicationMenu(getMainWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Preferences...",
                accelerator: "CmdOrCtrl+,",
                click: () => {
                  const win = getMainWindow();
                  if (win) win.webContents.send("navigate", "/admin?tab=settings");
                },
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Add Media Folder...",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            const win = getMainWindow();
            if (win) win.webContents.send("navigate", "/setup");
          },
        },
        {
          label: "Manage Libraries...",
          accelerator: "CmdOrCtrl+L",
          click: () => {
            const win = getMainWindow();
            if (win) win.webContents.send("navigate", "/admin?tab=libraries");
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" as const },
        { role: "zoom" as const },
        ...(isMac
          ? ([
              { type: "separator" as const },
              { role: "front" as const },
              { type: "separator" as const },
              { role: "window" as const },
            ] as MenuItemConstructorOptions[])
          : ([{ role: "close" as const }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      role: "help" as const,
      submenu: [
        {
          label: "Open Logs in Finder",
          click: () => {
            const logDir = path.join(app.getPath("logs"), "Plexy");
            shell.openPath(logDir);
          },
        },
        {
          label: "Open Data Directory",
          click: () => {
            const dataDir = path.join(app.getPath("appData"), "Plexy");
            shell.openPath(dataDir);
          },
        },
        { type: "separator" as const },
        {
          label: "Plexy on GitHub",
          click: () => {
            shell.openExternal("https://github.com");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
