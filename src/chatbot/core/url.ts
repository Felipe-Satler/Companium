/**
 * Return the URL only if it is a plain http(s) link; otherwise null.
 *
 * Blocks javascript:, data:, blob:, vbscript:, file: and every other scheme that
 * can execute script or smuggle content when placed in an href, window.open() or
 * img.src. URLs reaching these sinks come from model/backend output (artifact
 * download links, plot thumbnails) and are therefore untrusted.
 */
export function safeHttpUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const s = raw.trim();
    if (!s) return null;
    try {
        const u = new URL(s, window.location.origin); // resolves relative URLs against our origin
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch {
        return null;
    }
}
