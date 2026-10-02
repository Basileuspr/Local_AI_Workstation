function redactSecrets(value) {
    return String(value)
        .replace(/([?&#](?:code|state|access_token|refresh_token|id_token|client_secret|password|law_token|apiToken)=)[^&#\s"']*/gi,'$1REDACTED')
        .replace(/((?:authorization|proxy-authorization|set-cookie|cookie|password|passwd|client_secret|access_token|refresh_token|id_token|x-law-session)["']?\s*[:=]\s*)[^\r\n]*/gi,'$1REDACTED')
        .replace(/((?:law_token|apiToken)=)[^&\s"']+/gi,'$1REDACTED')
        .replace(/(Bearer\s+)[^\s"',;}]+/gi,'$1REDACTED');
}
module.exports={redactSecrets};
