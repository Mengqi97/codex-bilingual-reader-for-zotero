# Contributing

Please keep each pull request narrowly scoped and include a regression test for changes to paragraph segmentation or generated HTML.

Before opening a pull request, run:

```powershell
npm run check
npm test
npm run build
```

Never commit PDFs, generated HTML, translation caches, credentials, or the contents of `~/.codex/auth.json`.
