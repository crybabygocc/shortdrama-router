# `@shortdrama-router/provider-jimeng`

Jimeng adapter backed by the official local `dreamina` CLI. Authorization uses Jimeng's OAuth Device Flow; the router never reads or stores browser cookies.

Install the official CLI from Jimeng's **即梦 CLI** page, then authorize it:

```sh
dreamina login
shortdrama-router providers --probe
```

Jimeng currently limits generation through its official CLI to Advanced members. A normal Web login can still use the Jimeng website, but it does not grant CLI generation rights. The adapter reports that account restriction directly.
