# Security

Tech Comparison Hub is a static website on GitHub Pages: there is no server of its own, no database, no user accounts
and no form that sends personal data anywhere. What it does to stay safe:

- **Content from other sites is treated as untrusted.** Headline titles are escaped before they are shown, only
  `http(s)` addresses become links or pictures, and links to other sites open without passing the page to them
  (`rel="noopener noreferrer"`).
- **Content Security Policy.** The site's pages only run scripts from the site itself and the pinned version of the
  optional in-browser AI library on jsDelivr; plugins, frames and form posts to other sites are blocked. The plain
  device pages for search engines run no scripts at all.
- **HTTPS only**, with HSTS, as GitHub Pages enforces.
- **The build pipeline** (GitHub Actions) runs with read-only access to the repository, keeps no GitHub token after
  checkout, uses GitHub's own actions pinned to exact commits, and has no trigger that runs code from other people's
  pull requests. The only secret is a YouTube Data API key restricted to that API; GitHub hides it in logs and the site
  never publishes it.
- **The headline relay** (a Cloudflare Worker) only answers GET requests from this site and only fetches the feed
  addresses the site lists, so it cannot be used to reach other sites.

## Reporting a problem

If you find a security problem, please report it privately through the repository's **Security → Report a
vulnerability** page rather than in a public issue.
