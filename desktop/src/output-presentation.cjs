// Full screen of an output window, and closing one. Pure: the caller passes the window and the platform.
// macOS simple full screen hides the menu bar and the Dock for the whole app (NSApp presentation options), and only
// leaving it puts them back. Destroying the window while it's in full screen leaves them hidden, so every close path
// leaves full screen first.

const isFullScreen = (window, platform) => (platform === 'darwin' ? window.isSimpleFullScreen() : window.isFullScreen());
const setFullScreen = (window, on, platform) => { if (platform === 'darwin') window.setSimpleFullScreen(on); else window.setFullScreen(on); };

/**
 * Leaves full screen if the window is in it. Both calls go to the window itself, in main: they need nothing from the
 * renderer, and nobody waits for a full-screen event, so a hung page can't hold a close back.
 */
function leaveFullScreen(window, platform) {
  if (!window || window.isDestroyed()) return;
  try { if (isFullScreen(window, platform)) setFullScreen(window, false, platform); }
  catch (error) { console.error('Could not leave full screen:', error && error.message); }   // closing must go on
}

/** Leaves full screen, then destroys in the same tick. Safe on a missing or already destroyed window. */
function destroyOutputWindow(window, platform) {
  if (!window || window.isDestroyed()) return;
  leaveFullScreen(window, platform);
  if (!window.isDestroyed()) window.destroy();
}

/** Closes the system starts itself (⌘W, the Window menu, the taskbar) emit 'close'; destroy() doesn't. */
function leaveFullScreenOnClose(window, platform) {
  window.on('close', () => leaveFullScreen(window, platform));
}

module.exports = { isFullScreen, setFullScreen, leaveFullScreen, destroyOutputWindow, leaveFullScreenOnClose };
