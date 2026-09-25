/**
 * Main-process logging.
 *
 * A packaged Electron app has no console, so anything printed here is
 * otherwise lost. This matters most for the failures that only happen on
 * someone else's machine: a missing Python runtime, a port already in use, a
 * backend that dies before it can write its own log.
 *
 * Deliberately dependency-free and synchronous. Volume is low, and a log line
 * that arrives after a crash is worthless.
 */

const fs = require("fs");
const path = require("path");

const MAX_BYTES = 2_000_000;
const BACKUP_COUNT = 3;
const LOG_FILENAME = "electron.log";

let logDir = null;
let logFile = null;
let fileLoggingBroken = false;

// Desktop launches can outlive the shell that provided stdout/stderr. A closed
// console pipe must not crash the window or prevent backend shutdown.
for (const stream of [process.stdout, process.stderr]) stream?.on("error", () => {});

function resolveLogDir() {
  // Mirrors LAW_LOG_DIR on the Python side so both halves stay together.
  return process.env.LAW_LOG_DIR || path.join(process.env.LAW_DATA_DIR || path.join(__dirname, "..", "data"), "logs");
}

function ensureLogFile() {
  if (logFile || fileLoggingBroken) return logFile;
  try {
    logDir = resolveLogDir();
    fs.mkdirSync(logDir, { recursive: true });
    logFile = path.join(logDir, LOG_FILENAME);
  } catch {
    // Console logging carries on; losing the file must not stop the app.
    fileLoggingBroken = true;
  }
  return logFile;
}

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(logFile)) return;
    if (fs.statSync(logFile).size < MAX_BYTES) return;

    const oldest = `${logFile}.${BACKUP_COUNT}`;
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    for (let i = BACKUP_COUNT - 1; i >= 1; i -= 1) {
      const from = `${logFile}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${logFile}.${i + 1}`);
    }
    fs.renameSync(logFile, `${logFile}.1`);
  } catch {
    fileLoggingBroken = true;
  }
}

function timestamp() {
  const now = new Date();
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

// Output piped from the Python backend already carries its own timestamp and
// level. Re-stamping it would double every prefix.
const ALREADY_STAMPED = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s/;

function emit(level, line) {
  try {
    if (level === "ERROR") console.error(line);
    else if (level === "WARNING") console.warn(line);
    else console.log(line);
  } catch { /* File logging below remains available without a console. */ }

  if (!ensureLogFile() || fileLoggingBroken) return;
  rotateIfNeeded();
  try {
    fs.appendFileSync(logFile, `${line}\n`, "utf8");
  } catch {
    fileLoggingBroken = true;
  }
}

function write(level, scope, message) {
  // Split so a multi-line chunk does not leave continuation lines unlabelled.
  const lines = String(message).replace(/((?:law_token|apiToken)=)[^&\s"']+/gi, "$1REDACTED")
    .replace(/(Bearer\s+|X-LAW-Session["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, "$1REDACTED")
    .split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  if (lines.length === 0) return;

  for (const line of lines) {
    emit(level, ALREADY_STAMPED.test(line) ? line : `${timestamp()} ${level.padEnd(8)} ${scope}: ${line}`);
  }
}

function format(parts) {
  return parts
    .map((part) => {
      if (part instanceof Error) return part.stack || part.message;
      if (typeof part === "string") return part;
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .join(" ");
}

function createLogger(scope) {
  return {
    info: (...parts) => write("INFO", scope, format(parts)),
    warn: (...parts) => write("WARNING", scope, format(parts)),
    error: (...parts) => write("ERROR", scope, format(parts)),
  };
}

function logFilePath() {
  const target = ensureLogFile();
  return fileLoggingBroken ? null : target;
}

module.exports = { createLogger, logFilePath };
