// What main pushes to the control window: every output status, and the display list. Pure: main passes the sender.
// DisplayInfo.hostsOutput says which output is on a display, so the list the panel holds goes stale when an output
// starts or stops occupying one, not only when the screens change. The list is sent then too, and only then: status
// reports arrive about twice a second and must not flood it.

/** Are two Map<electronId, outputId> the same occupancy? */
function sameOccupancy(a, b) {
  if (a.size !== b.size) return false;
  for (const [electronId, outputId] of a) if (b.get(electronId) !== outputId) return false;
  return true;
}

/**
 * @param deps.send (channel, value) => boolean   to the control window; false when there is none
 * @param deps.occupancy () => Map               outputs.outputOnDisplay()
 * @param deps.listDisplays () => DisplayInfo[]
 * @param deps.channels { status, displaysChanged }
 */
function createControlPush({ send, occupancy, listDisplays, channels }) {
  let sent = new Map();   // the occupancy in the last list the control window got; before any list, nothing is occupied
  return {
    /** The status first, then the list if it changed who is on which display. Sends only: never calls the controller. */
    status(status) {
      send(channels.status, status);
      const now = occupancy();
      if (!sameOccupancy(now, sent) && send(channels.displaysChanged, listDisplays())) sent = new Map(now);
    },
    /** The displays changed (screen events, debounced by main). */
    displays() {
      const now = occupancy();
      if (send(channels.displaysChanged, listDisplays())) sent = new Map(now);
    },
    /** The control window just asked for the list itself (output:list-displays). */
    listed() { sent = new Map(occupancy()); },
  };
}

module.exports = { sameOccupancy, createControlPush };
