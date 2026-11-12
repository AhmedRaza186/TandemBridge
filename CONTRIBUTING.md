# Contributing

## Getting started

```powershell
npm install
npm test
```

Tests use throwaway databases and scripted agents. They need no agent logins and spend no quota.
See [docs/architecture.md](docs/architecture.md) for how the code is organized.

## Pull requests

- Keep each pull request to one change.
- Add or update a test for any change in behavior.
- Run `npm test` before opening it.
- Alerts live in `src/notifications/messages.js`, in English. Add new ones there rather than
  writing text inline, so that they can be translated.

## Adding a UI style pack

Add a folder under `references/` as described in [references/README.md](references/README.md). Write
the guide in your own words. Do not include another site's text, images, logos, or code.
