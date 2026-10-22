// Le pont entre les pages de l'appli (connexion, hors ligne) et l'appli. Le site, lui, n'en reçoit rien.
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("kafmonde", {
    // action : "login" ou "register" ; renvoie { ok, name } ou { error }.
    account: (action, username, password) => ipcRenderer.invoke("kafmonde:compte", { action, username, password }),
  });
}
