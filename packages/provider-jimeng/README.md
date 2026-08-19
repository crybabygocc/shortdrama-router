# `@shortdrama-router/provider-jimeng`

Jimeng adapter backed by the official local `dreamina` CLI. Authorization uses Jimeng's OAuth Device Flow; the router never reads or stores browser cookies.

Install the managed official runtime through shortdrama-router, then authorize it:

```sh
shortdrama-router providers install jimeng
shortdrama-router providers --probe
```

The standalone shortdrama-router executable does not require Node.js or npm. It downloads the platform-specific official CLI into shortdrama-router's application data directory and executes that absolute path without changing the user's PATH or shell profile. Authorization is then started through the provider authorization API. `DREAMINA_CLI_PATH` remains an explicit developer override.

Jimeng currently limits generation through its official CLI to Advanced members. A normal Web login can still use the Jimeng website, but it does not grant CLI generation rights. The adapter reports that account restriction directly.
