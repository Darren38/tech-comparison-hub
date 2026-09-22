import { html } from '../lib/html.js';
import { href } from '../core/router.js';
import { emptyState, pageTrail } from '../ui/components.js';

/** Unknown routes, and known routes whose id is not in the database (`message` explains which). */
export default async function render({ path, message }) {
  return {
    title: 'Page not found',
    html: html`${pageTrail([{ label: 'Home', href: href('/') }, { label: 'Page not found' }])}${emptyState(
      'Page not found',
      message ? `${message} The link may be out of date.` : `Nothing lives at “${path}”. The link may be out of date.`,
      html`<div class="row" style="justify-content:center"><a class="btn btn--primary" href="${href('/')}">Go to the homepage</a><a class="btn" href="${href('/devices')}">Browse devices</a></div>`,
      { level: 1 },
    )}`,
  };
}
