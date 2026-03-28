const sanitizeHtml = require('sanitize-html');

// Allowlist for rich text descriptions (matches Quill toolbar output)
const SANITIZE_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: {
    a: ['href', 'target', 'rel']
  },
  transformTags: {
    a: (tagName, attribs) => {
      let href = attribs.href || '';
      // Only allow http and https links — block javascript:, data:, vbscript:, etc.
      try {
        const url = new URL(href, 'https://placeholder.invalid');
        if (url.protocol !== 'http:' && url.protocol !== 'https:') href = '';
      } catch {
        href = '';
      }
      return {
        tagName,
        attribs: {
          href,
          target: '_blank',
          rel: 'noopener noreferrer'
        }
      };
    }
  }
};

function sanitize(html) {
  if (!html) return '';
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

module.exports = { sanitize };
