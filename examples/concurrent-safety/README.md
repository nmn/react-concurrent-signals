# react-concurrent-signals website

Waku + StyleX site for the `react-concurrent-signals` examples and
documentation.

Run from the package root:

```sh
npm run dev:examples
npm run build:examples
```

The Waku app uses `@stylexjs/unplugin` in `waku.config.ts`, following the
StyleX `example-waku` setup: CSS-only dev mode, persisted dev CSS, no runtime
injection, and a small `DevStyleXInject` client component for Waku's document
shell.

Deploy to Cloudflare Workers Assets:

```sh
npm run deploy:examples
```
