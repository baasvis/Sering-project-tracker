import sanitizeHtml from 'sanitize-html';

// Allowlist for rich text descriptions (matches Quill toolbar output)
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
  },
  transformTags: {
    a: (_tagName, attribs) => {
      let href = attribs.href || '';
      // Only allow http and https links — block javascript:, data:, vbscript:, etc.
      try {
        const url = new URL(href, 'https://placeholder.invalid');
        if (url.protocol !== 'http:' && url.protocol !== 'https:') href = '';
      } catch {
        href = '';
      }
      return {
        tagName: 'a',
        attribs: {
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      };
    },
  },
};

export function sanitize(html: string | null | undefined): string {
  if (!html) return '';
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
