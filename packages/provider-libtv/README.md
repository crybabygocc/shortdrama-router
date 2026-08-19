# `@shortdrama-router/provider-libtv`

LibTV adapter backed by the official local `libtv` CLI. Credentials remain in LibTV's local CLI configuration and are never copied into router requests or repository files.

Install the managed official runtime, start Web OAuth through the provider authorization API, then select a project through the provider resource/configuration API or configure its UUID locally:

```sh
shortdrama-router providers install libtv
export LIBTV_PROJECT_UUID=your_32_character_canvas_uuid
shortdrama-router providers --probe
```

The standalone shortdrama-router executable does not require Node.js or npm. It downloads LibTV's platform-specific official ZIP into shortdrama-router's application data directory, verifies pinned SHA-256 values for the ZIP and executable, and uses only that absolute managed path without changing PATH. It never falls back to `~/.libtv/libtv`. `LIBTV_CLI_PATH` remains an explicit developer override.

Interactive authorization starts `libtv login web` in the background and returns the official login URL through the common `beginAuthorization("oauth")` contract. The host opens that URL and polls authorization state until it becomes `valid`; pending authorization can be cancelled. The CLI callback and credentials remain local, and every LibTV command uses the same configured `LIBTV_CONFIG_DIR`.

The adapter queries LibTV's live provider-scoped model catalog and model schemas. Authorization and project selection are reported separately: a valid login does not imply generation readiness until a project is selected. Text-to-image and text-to-video requests revalidate the account and selected project, execute as uniquely named nodes, and return the terminal media URLs reported by the official CLI.
