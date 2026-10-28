const { DeviceVpn } = require('./device-vpn');

// Only the top-level app renderer may request VPN changes. Import always uses
// the native file picker rather than accepting arbitrary filesystem paths.
function registerDeviceVpn({ipcMain, app, dialog, safeStorage, getWindow, isTrusted}) {
  let instance;
  const device = () => instance || (instance = new DeviceVpn({storagePath:app.getPath('userData'), safeStorage}));
  const handle = (channel, action) => ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrusted(event)) throw new Error('Device VPN controls are restricted to the OpenPath window');
    return action(...args);
  });
  handle('device-vpn:status', () => device().status());
  handle('device-vpn:import', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title:'Import WireGuard profile', properties:['openFile'],
      filters:[{name:'WireGuard configuration', extensions:['conf']}],
    });
    if (result.canceled || result.filePaths.length !== 1) return {canceled:true};
    return device().importFile(result.filePaths[0]);
  });
  handle('device-vpn:remove', () => device().removeProfile());
  handle('device-vpn:connect', options => device().connect(options));
  handle('device-vpn:disconnect', () => device().disconnect());
  // Keep the historical bridge names functional, without claiming mock TUN success.
  handle('tun:start', options => device().connect(options));
  handle('tun:stop', () => device().disconnect());
  handle('tun:stats', () => device().status());
  handle('tun:mode', () => device().status());
}
module.exports = {registerDeviceVpn};
