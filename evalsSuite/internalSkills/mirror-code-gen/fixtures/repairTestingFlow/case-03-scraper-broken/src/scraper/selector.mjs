export function extractHref(tag) {
    const match = tag.match(/href=["']([^"']+)["']/i);
    return match ? match[1] : null;
}
