# Contributing to HomeDeck

Thanks for your interest! HomeDeck is a small, dependency-free project and we'd like to keep it that way.

## Ground rules

- **No runtime dependencies.** Node built-ins only (Node 20+). Please don't add a `package.json` dependency or a build step.
- **Client code must run on old WebViews** (the target is aging Android tablets/phones): plain ES5-style JS in `public/`, no `?.`, no `??`, no bundler.
- **Read-only by default.** Collectors that talk to other systems (Home Assistant, Gitea, Docker) must only read.
- **No personal data** in code, docs, screenshots or tests: no real IPs, tokens, usernames or hostnames. Use placeholders such as `192.0.2.10` or `HUB_IP`.
- The UI language is Turkish; code comments are mostly Turkish too. English or Turkish is fine for issues and pull requests.

## Setup

```bash
git clone https://github.com/cnbrkdmrl/homedeck.git
cd homedeck
DEMO_SESSIONS=1 DEMO_QUOTAS=1 DEMO_CALENDAR=1 DEMO_HA=1 DEMO_MODEM=1 npm start   # http://localhost:8787
```

On macOS/Windows, system metrics and Docker are simulated. There is no test suite yet; before opening a PR please run `node --check` on the files you changed and click through the affected widgets in the browser.

## Adding a data source

1. Create `server/collectors/<name>.js` exporting `{ name, interval, run() }` (`run()` returns `{ data, simulated }`).
2. Register it in `server/collectors/index.js`. Gate optional sources behind an environment variable and keep them off when it is unset.
3. Add the widget to `CATALOG` and `widgets.<type>` in `public/app.js`, plus styles in `public/style.css`.
4. Document new environment variables in `.env.example` and the README.

Keep parsing logic in small pure functions so it can be tested without network access.

## Pull requests

- One topic per PR, with a short description of what and why.
- Include a screenshot for visible changes (demo mode, no real data).
- Don't commit `.env`, tokens or `data/`.

## Security issues

Please don't open public issues for vulnerabilities; see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
