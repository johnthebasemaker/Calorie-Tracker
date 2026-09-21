/**
 * Capacitor configuration.
 *
 * Written as CommonJS .js rather than the more usual .ts on purpose: this
 * project is
 * deliberately build-free vanilla JavaScript, and pulling in the TypeScript
 * compiler purely so the CLI can read one config file would be the first
 * crack in that. A .json file would avoid TypeScript too, but JSON cannot
 * carry the reasoning below, and every line of it is a decision someone will
 * otherwise have to rediscover.
 *
 * The appId must keep matching the listing on Play. Change it and Google
 * treats the upload as an entirely different app, with a new install base.
 */

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: 'com.john3004.calorietracker',
  appName: 'Calorie Tracker',
  webDir: 'www',
  android: {
    /* Serve from https://localhost so the WebView counts as a secure context.
     * Three things in this app depend on that and silently break without it:
     * localStorage durability (every entry, food and setting lives there),
     * navigator.mediaDevices.getUserMedia for the barcode scanner, and the
     * fetch() calls to OpenRouter and Open Food Facts, which a browser blocks
     * as mixed content from an http:// origin. */
    androidScheme: 'https',
  },
};

module.exports = config;
