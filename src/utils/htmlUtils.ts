/**
 * Utility functions for HTML entity decoding, sanitization, and text formatting for email content.
 */

/**
 * Decodes HTML entities (e.g. &#39; -> ', &amp; -> &, &quot; -> ", &lt; -> <)
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';

  // Standard entity dictionary for basic fast replacement
  let decoded = text
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

  // If running in browser environment, use DOM element for full entity decoding
  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = decoded;
      decoded = textarea.value;
    } catch (e) {
      // Fallback to dictionary decoding
    }
  }

  return decoded;
}

/**
 * Strip HTML tags to extract raw plain text
 */
export function stripHtmlTags(html: string): string {
  if (!html) return '';
  // Convert line breaks and paragraph breaks to newline characters
  let text = html
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode entities
  return decodeHtmlEntities(text).trim();
}

/**
 * Checks if content contains HTML elements
 */
export function isHtmlContent(content: string): boolean {
  if (!content) return false;
  return /<[a-z][\s\S]*>/i.test(content);
}
