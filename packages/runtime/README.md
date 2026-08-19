# `@shortdrama-router/runtime`

Provider-neutral support for installing executable runtimes into shortdrama-router's application data directory.

Concrete providers own their official URLs, platform artifact names, trusted artifact and executable SHA-256 values, and version probes. This package verifies both the download and extracted executable before installation, re-verifies the installed executable before execution, and supplies bounded HTTPS downloads, application-data paths and atomic replacement. An unrecognized release or mismatched digest fails closed. It never invokes an upstream installer script, changes PATH and shell profiles, or discovers an unmanaged fallback executable.
