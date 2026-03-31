function log(level, message, context = {}) {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };

  if (level === "error") {
    console.error(JSON.stringify(payload));
    return;
  }

  console.log(JSON.stringify(payload));
}

function info(message, context) {
  log("info", message, context);
}

function warn(message, context) {
  log("warn", message, context);
}

function error(message, context) {
  log("error", message, context);
}

module.exports = {
  info,
  warn,
  error,
};
