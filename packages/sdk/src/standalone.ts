import { runCli } from "./cli.js"

void runCli(process.argv.slice(2)).then(
  code => {
    process.exitCode = code
  },
  error => {
    process.stderr.write(`shortdrama-router failed: ${error instanceof Error ? error.message : "unknown error"}\n`)
    process.exitCode = 1
  },
)
