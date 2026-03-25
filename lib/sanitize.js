const sanitizeHtml = require('sanitize-html');

// Allowlist for rich text descriptions (matches Quill toolbar output)
const SANITIZE_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: {
    a: ['href', 'target', 'rel']
  },
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        href: attribs.href || '',
        target: '_blank',
        rel: 'noopener noreferrer'
      }
    })
  }
};

function sanitize(html) {
  if (!html) return html;
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

module.exports = { sanitize };
