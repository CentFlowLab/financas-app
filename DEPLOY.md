# Publicar (HTTPS permanente)
`dist/` é estático. Config já incluída: `netlify.toml` (build `npm run build`, publish `dist`) e `public/_headers`.

## Netlify (mais simples, sem Git)
1. `npm run build`
2. https://app.netlify.com/drop → arrastar a pasta `dist/` (precisa de conta gratuita) → URL https://<nome>.netlify.app
   Ou CLI: `npx netlify-cli login && npx netlify-cli deploy --prod --dir=dist`

## Cloudflare Pages
`npx wrangler login && npx wrangler pages deploy dist --project-name financas` → https://financas.pages.dev

## GitHub Pages
Repo → push `dist/` (ou Action que corre `npm ci && npm run build`) → Settings › Pages. Fica em /<repo>/ (a app usa caminhos relativos).

No telemóvel: abrir o URL em Safari/Chrome → "Adicionar ao ecrã principal".
