import sanitizeHtml from 'sanitize-html';

// Sanitize campaign body HTML before it is STORED. Campaigns are authored by
// authenticated staff but rendered to OTHER staff (campaign detail page) and
// emailed to recipients — so a saved <script>/onerror=/javascript: is a stored
// XSS + email-injection vector. We sanitize on write so every downstream consumer
// (detail render, Resend send, trigger send) gets clean HTML.
//
// Allowlist = the formatting a marketing email realistically needs. Everything
// else (script/style/iframe/object, on* handlers, javascript:/data: URLs) is
// stripped. Links and images keep only safe schemes.
export function sanitizeCampaignHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'hr', 'span', 'div',
      'strong', 'b', 'em', 'i', 'u', 's', 'small', 'sub', 'sup', 'mark',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'td', 'th', 'caption',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      '*': ['style', 'align'],
    },
    // http(s)/mailto/tel for links; http(s) + data:image for inline images.
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    // Keep inline styling but drop anything with a url()/expression() payload.
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb/, /^[a-z]+$/],
        'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb/, /^[a-z]+$/],
        'text-align': [/^(left|right|center|justify)$/],
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        'font-size': [/^\d+(px|em|rem|%)$/],
        padding: [/^[\d\s.a-z%]+$/],
        margin: [/^[\d\s.a-z%]+$/],
      },
    },
    disallowedTagsMode: 'discard',
  });
}
