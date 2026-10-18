# Finanças — gestão financeira pessoal (PWA)

Aplicação web instalável (PWA), 100 % em português de Portugal, **sem servidor e sem contas**: todos os dados ficam no seu dispositivo (IndexedDB) e a app funciona offline.

## Funcionalidades (versão 1)

- **Painel** — resumo do mês (entradas, saídas, saldo), gráfico "para onde vai o dinheiro", entradas vs. saídas dos últimos 6 meses, saldo por conta, dívida total, alertas de garantias, resumo de combustível, navegação entre meses.
- **Movimentos** — entradas e saídas (valor, data, categoria, conta, nota), editar/apagar, filtros por mês, categoria, conta, tipo e pesquisa.
- **Contas** — conta à ordem, poupança, dinheiro, cartão de crédito, investimentos…; saldos calculados a partir dos movimentos; transferências entre contas.
- **Dívidas** — credor, total, saldo em dívida, taxa de juro, prestação; registo de pagamentos (opcionalmente debitados de uma conta); progresso; projeção de liquidação **avalanche vs. bola de neve** (com valor extra mensal).
- **Talões** — fotografe um talão: OCR local (tesseract.js, português) extrai loja, data, total e artigos; reveja e guarde (cria o movimento e os preços).
- **Combustível** — veículos, abastecimentos, L/100 km, €/L, custo por km e gráficos.
- **Garantias** — produto, data de compra, duração (36 meses por omissão), foto do talão, alerta de expiração (painel, menu e aviso ao abrir).
- **Preços** — comparação do mesmo produto entre lojas, loja mais barata, poupança e histórico (alimentado por talões ou à mão).
- **Assistente** — pergunte em português sobre gastos, saldos, dívidas, consumo, garantias e preços. Funciona localmente; opcionalmente liga a uma API de IA compatível com OpenAI (Definições).
- **Categorias** editáveis (Supermercado, Combustível, Casa, Saúde, Lazer, Transportes, Restaurantes, Salário…), tema claro/escuro, **exportar/importar cópia de segurança (JSON, inclui fotos)**.

### Novidades (Painel, navegação e acessibilidade)
- **Painel**: cartões Entradas/Saídas/Saldo com variação face ao mês anterior (↑/↓ e %; para as Saídas subir é "mau"; no mês em curso compara com o mesmo período do mês anterior); atalhos rápidos (Despesa rápida, Ler talão, Abastecimento, Garantias); botão flutuante **Despesa rápida** (folha inferior com valor + categoria; conta, nota e data opcionais; usa hoje e a última conta usada); **orçamento mensal por categoria** com barras (verde < 80 %, laranja ≥ 80 %, vermelho ≥ 100 %), editável no Painel ("Orçamentos") ou em Categorias.
- **Movimentos**: só a pesquisa fica visível; mês, categoria, conta e tipo estão na folha **Filtros**, com contagem de filtros ativos.
- **Acessibilidade**: texto secundário com contraste ≥ 4,5:1 nos dois temas (≥ 7:1 no escuro), áreas de toque ≥ 44 px e `aria-label`s; o teste e2e verifica contraste e tamanhos de toque.

## Como correr

Requisitos: Node.js 18+.

```bash
npm install          # só necessário para testes/build de ícones (a app em si não tem dependências)
npm run build        # gera a pasta estática dist/ (e a lista de pré-cache offline)
npm run serve        # serve dist/ em http://localhost:8080
# ou tudo de uma vez:
npm start
```

A pasta `dist/` é 100 % estática: pode ser publicada em qualquer alojamento (Netlify, GitHub Pages, Cloudflare Pages, Nginx…). Precisa de **HTTPS** (ou `localhost`) para instalar a PWA e usar a câmara/service worker.

Para desenvolver sem build: `npm run serve:dev` (serve `public/` em http://localhost:8081).

### Instalar
- **Telemóvel**: abrir o endereço no Chrome/Safari → menu → "Adicionar ao ecrã principal".
- **Computador**: ícone "Instalar" na barra de endereço, ou Definições → Instalar.

### Testes
```bash
npx playwright install chromium    # uma vez
npm start &                        # servidor em :8080
npm test                           # BASE=http://localhost:8080 node tests/e2e.mjs
```
O teste ponta-a-ponta cobre todos os módulos, OCR com um talão sintético, exportar/importar, tema, offline e erros de consola.

## Estrutura

```
public/                 código-fonte da app (HTML/CSS/JS sem framework)
  index.html, manifest.webmanifest, sw.js
  css/app.css
  js/main.js            router + navegação (registo de módulos)
  js/db.js              IndexedDB, estado, exportar/importar
  js/model.js           saldos, dívidas, combustível, garantias, preços
  js/modules/*.js       um ficheiro por separador
  js/ocr.js, receipt-parser.js, image.js, charts.js, ui.js, util.js, demo.js
  vendor/tesseract/     motor OCR + dados de português (local, funciona offline)
scripts/build.mjs       public/ → dist/ + pré-cache do service worker
scripts/serve.mjs       servidor estático mínimo
tests/e2e.mjs           teste ponta-a-ponta (Playwright)
```

### Modelo de dados (v2, esquema `financas-pessoais`)
Valores em **cêntimos**; datas `AAAA-MM-DD` (apresentadas `dd/mm/aaaa`); fotos em Blob na store `images`.
Coleções: `accounts`, `categories`, `movements` (entrada | saida | transferencia), `debts`, `debtPayments`, `vehicles`, `fuel`, `warranties`, `receipts`, `prices`, mais `settings`. **v2** acrescenta `categories[].orcamento` (cêntimos/mês, só categorias de saída; `null` = sem orçamento); `migrate()` em `db.js` converte dados v1 ao abrir. Registos ligados (pagamento de dívida, abastecimento, talão) guardam `movId` do movimento que geraram. Para acrescentar um módulo: criar `js/modules/xxx.js` (`{id, titulo, icone, render, mount}`), juntá-lo à lista em `main.js` e, se precisar de dados, acrescentar a coleção em `db.js` (`COLLS`) — a exportação/importação passa a incluí-la.

## Privacidade
Nada sai do dispositivo, exceto se ativar o assistente com IA online (envia a pergunta e um resumo do mês ao serviço escolhido; a chave de API fica só no dispositivo e não entra na cópia de segurança).
Os dados vivem no armazenamento do navegador: **faça cópias de segurança regulares** (Definições → Exportar).
