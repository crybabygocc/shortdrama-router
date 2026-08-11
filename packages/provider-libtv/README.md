# `@shortdrama-router/provider-libtv`

LibTV adapter backed by the official local `libtv` CLI. Credentials remain in LibTV's local CLI configuration and are never copied into router requests or repository files.

Install and authorize the official CLI from LibTV's **CLI & Skill** page, then configure a target canvas UUID:

```sh
export LIBTV_PROJECT_UUID=your_32_character_canvas_uuid
shortdrama-router providers --probe
```

The adapter queries LibTV's live provider-scoped model catalog. Text-to-image and text-to-video requests execute as uniquely named nodes on the configured canvas and return the terminal media URLs reported by the official CLI.
