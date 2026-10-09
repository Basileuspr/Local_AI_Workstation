function redactSecrets(value) {
    return String(value)
        .replace(/([?&#](?:code|state|access_token|refresh_token|id_token|client_secret|password|law_token|apiToken|api_key|apikey|token|sessionid|session|csrf|signature|sig|key)=)[^&#\s"']*/gi,'$1REDACTED')
        .replace(/((?:authorization|proxy-authorization|set-cookie|cookie|password|passwd|client_secret|access_token|refresh_token|id_token|x-law-session|x-local-files|api_key|apikey|sessionid|session|token|secret|csrf)["']?\s*[:=]\s*)[^\r\n]*/gi,'$1REDACTED')
        .replace(/(https?:\/\/)[^\s\/]+:[^\s\/]+@/gi,'$1')
        .replace(/((?:law_token|apiToken)=)[^&\s"']+/gi,'$1REDACTED')
        .replace(/(Bearer\s+)[^\s"',;}]+/gi,'$1REDACTED');
}
module.exports={redactSecrets};
