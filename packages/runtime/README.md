# `@shortdrama-router/runtime`

Provider-neutral support for installing executable runtimes into shortdrama-router's application data directory.

Concrete providers own their official URLs, platform artifact names and version probes. This package supplies bounded HTTPS downloads, binary/ZIP installation, application-data paths, atomic replacement and executable probing. It never invokes an upstream installer script or changes PATH and shell profiles.
