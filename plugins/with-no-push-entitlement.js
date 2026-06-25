const { withEntitlementsPlist } = require('expo/config-plugins');

// Free / personal Apple teams cannot sign the Push Notifications capability, and
// this app uses only LOCAL notifications (the geofence "memory" alerts) — it
// never registers for remote/APNs push — so the `aps-environment` entitlement
// that `expo-notifications` adds by default is unnecessary. Strip it after that
// plugin runs so `expo prebuild` output signs on a free team.
//
// This plugin must be listed AFTER "expo-notifications" in app.json so its
// entitlements modifier runs last. To restore push (e.g. on a paid team that
// adds remote notifications), remove this plugin entry and re-run prebuild.
module.exports = function withNoPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
