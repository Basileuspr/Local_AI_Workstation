const {isIP} = require('node:net');

function publicAddress(address) {
    address = String(address).replace(/^\[|\]$/g, '').toLowerCase();
    if (isIP(address) === 4) {
        const [a,b,c] = address.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
            || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18,19].includes(b))
            || (a === 192 && b === 0) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
    }
    return isIP(address) === 6 && /^[23]/.test(address) && !/^(2001:(db8|0):|2002:)/.test(address);
}

function browserUrl(value, {input=false, sockets=false} = {}) {
    if (typeof value !== 'string' || value.length > 8192) return null;
    try {
        let raw = value.trim();
        if (input && !/^[a-z][a-z\d+.-]*:/i.test(raw)) raw = `https://${raw}`;
        const url = new URL(raw), host = url.hostname.replace(/^\[|\]$/g,'').toLowerCase().replace(/\.$/,'');
        if (!(sockets ? ['http:','https:','ws:','wss:'] : ['http:','https:']).includes(url.protocol)
            || url.username || url.password || !host || url.searchParams.has('law_token') || url.searchParams.has('apiToken')) return null;
        if (isIP(host) ? !publicAddress(host) : !host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)) return null;
        return url.href;
    } catch {return null;}
}

async function allowedBrowserRequest(value, resolveHost) {
    const url = browserUrl(value, {sockets:true});
    if (!url) return false;
    const host = new URL(url).hostname.replace(/^\[|\]$/g,'');
    if (isIP(host)) return publicAddress(host);
    try {
        const result = await resolveHost(host);
        return !!result.endpoints?.length && result.endpoints.every(endpoint=>publicAddress(endpoint.address));
    } catch {return false;}
}

module.exports = {browserUrl, publicAddress, allowedBrowserRequest};
