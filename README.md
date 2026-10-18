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

## Importar extratos (versão 1.1)

Painel, Contas, Movimentos e Definições têm um botão **Importar extrato** (também em Mais → Importar extratos). O assistente tem 4 passos: **Ficheiro → Colunas → Contas → Rever**, e no fim grava tudo de uma vez. Há um botão **Experimentar com extrato de exemplo** (dados fictícios) para ver o fluxo sem ficheiros reais.

**Tudo é processado no próprio dispositivo** — o ficheiro nunca é enviado para lado nenhum. As bibliotecas de leitura estão incluídas na app (sem CDN), são carregadas só quando necessárias e ficam em pré-cache, por isso também funciona offline.

### Formatos
| Formato | Notas |
|---|---|
| CSV | delimitador `;` ou `,` detetado; UTF-8, Windows-1252 e ISO-8859-1; linhas de cabeçalho/título antes da tabela são ignoradas |
| Excel `.xlsx` / `.xls` | SheetJS 0.18.5 (local); escolha da folha |
| OFX | SGML e XML; saldo final (`LEDGERBAL`) usado para o saldo de abertura |
| QIF | datas e valores com vírgula decimal |
| PDF (texto) | **melhor esforço** — pdf.js 5.6 (local). Leitor **genérico** (qualquer banco/layout): tabela detetada por cabeçalhos PT/EN/ES e posição das colunas, com alternativa por linhas «data … valor». Obriga a confirmar «Revi os movimentos» antes de importar |
| PDF digitalizado, PNG, JPG, WebP | **melhor esforço** — as páginas/imagens são lidas por OCR (tesseract.js, local, offline) e passam pelo mesmo leitor de tabelas. Confiança nunca «alta»; revisão obrigatória |
| Interpretação com IA (opcional) | Só aparece com chave de API em Definições (compatível com OpenAI). O texto do extrato é enviado ao serviço configurado **só depois de confirmar, de cada vez** (IBAN/números longos reduzidos aos 4 últimos dígitos); o resultado passa pelas mesmas validações e pela revisão |

### O que faz
- **Mapeamento de colunas** inteligente (data movimento/valor, descrição, montante com sinal ou Débito/Crédito, saldo, IBAN/conta) com pré-visualização em direto; números `1.234,56`, `1 234,56`, sinal no fim, `€`; datas `dd-mm-aaaa`, `dd/mm/aaaa`, `aaaa-mm-dd`.
- **Contas**: deteta a conta por IBAN/NIB, metadados ou nome do ficheiro; propõe «Criar conta nova» (nome, tipo e saldo de abertura calculado para o saldo da app coincidir com o saldo final do extrato) ou associar a uma conta existente. Um ficheiro pode ter várias contas.
- **Revisão**: categorias sugeridas por regras de palavras-chave PT (Continente, Pingo Doce, Galp, Via Verde, EDP, MB WAY, comissões…); possíveis duplicados (mesma conta + data + valor + descrição parecida) vêm desmarcados; pode desmarcar, mudar categoria e trocar entrada/saída.
- **Aprende** correções descrição → categoria (guardadas na base de dados, geríveis em Importar extratos).
- **Transferências entre as suas contas** (valores simétricos em ≤3 dias, na mesma importação) são propostas como transferência.
- **Histórico** de importações com **Anular importação** (remove exatamente os movimentos e contas criados). Reimportar o mesmo ficheiro é seguro (deteção por hash e duplicados).

### Limitações (honestas)
- **Os testes só usam ficheiros fictícios** gerados em `tests/fixtures` (`npm run fixtures`); nenhum dado pessoal real é guardado no repositório.
- **Layouts de bancos** (CGD, Millennium bcp, Novo Banco, Santander, BPI, ActivoBank, Moey, Montepio, Revolut, N26, Trade Republic, Wise) são heurísticas genéricas por nome de coluna; não são formatos oficiais confirmados. Se o mapeamento automático falhar, ajuste no passo «Colunas».
- **PDF/imagem — o que o leitor genérico faz** (`js/import/layout.js`, `tokens.js`, `pdfstatement.js`): linhas e colunas a partir da posição do texto (pdf.js) ou das caixas de palavras (OCR); tabela por cabeçalhos (`Data`, `Data Mov./Valor`, `Descrição/Descritivo/Movimento/Details/Concepto`, `Débito/Crédito/Débitos/Créditos/Montante/Valor/Amount/Importe`, `Saldo/Balance`) ou, sem cabeçalho, linhas com data no início e valor(es) no fim; valor único com sinal, Débito/Crédito separados, sinal no fim (`45,00-`), `CR/DB`; datas `dd-mm`, `dd/mm`, `dd.mm`, `dd-mm-aaaa`, `aaaa-mm-dd`, `12 abr`, `12 Apr 2026`, `Apr 12, 2026` (ano deduzido do período/título quando falta); descrições de várias linhas; data de movimento vs. data valor; cabeçalhos/rodapés repetidos e texto rodado na margem ignorados; vários produtos num PDF (contas, poupança, cartões) reconhecidos como secções que o utilizador escolhe importar, créditos como sugestão opcional de dívida; **validação por cadeia de saldos** (correção automática de sinais) e pelo saldo inicial/final; sem coluna de saldo, o sinal deduz-se da coluna (débito/crédito), de marcas e de palavras-chave (compra, pagamento, transferência enviada/recebida, juros, comissão, ordenado…) e as linhas duvidosas ficam como «sinal incerto». Hints de bancos específicos (ex.: Santander consolidado) são só reforços opcionais.
- **Extratos de cartão de crédito** (`js/import/cardstatement.js`): detetados por palavras-chave (Cartão de Crédito, Limite de Crédito, Saldo em Dívida, TAN, Montante mínimo a pagar) e importados para uma conta do tipo **cartão de crédito** com a dívida como saldo negativo (débitos aumentam a dívida, créditos/pagamentos reduzem-na). Lê datas `dd.mm` com ano deduzido do período (incl. viragem de ano e compras anteriores ao início do período), 2.ª data como data valor, valores sem zero à esquerda (`,30`) e com sufixo `EUR`, valor em moeda original (guardado à parte e mostrado na descrição), linhas de comissões/impostos sem data (movimentos próprios, com a data da compra a que pertencem) e linhas só com data valor (juros/imposto de selo). Colunas Débitos/Créditos por posição (mesmo com indentação diferente por página); «Detalhe dos pagamentos», mensagens e avisos legais são ignorados. O saldo inicial é `−dívida do extrato anterior` e o final `−dívida atual`; o **resumo da página 1** valida a leitura (totais de débitos/créditos e saldo — avisa se não batem). Extratos seguintes (mesmo n.º de cartão mascarado/contrato) vão para a mesma conta, verificando a continuidade do saldo e ignorando duplicados. Opcional: guardar limite e TAN (mostra «Disponível … de …» em Contas). Categorias sugeridas: «Comissões e juros», «Transferências» (MB Way `TRFI PARA…`); pagamentos do cartão (`TRF IMEDIATA`) emparelham com a saída correspondente da conta à ordem (mesmo valor, ±5 dias, em qualquer ordem de importação) como **transferência interna**.
- **PDF sem linhas reconhecidas**: em vez de um erro, abre «Ajustar leitura do PDF» com o texto extraído (pré-visualização), formato da data, «datas dd.mm» e tipo de conta, para tentar de novo com outras opções.
- **Confiança e ajuste manual**: depois de escolher o ficheiro vê «Detetei N movimentos de M contas, confiança alta/média/baixa» (e porquê). Confiança **baixa** (ou nenhum movimento) leva ao passo **«Ajustar leitura do PDF»**: pré-visualização das linhas/colunas lidas, escolha do papel de cada coluna (data, descrição, débito, crédito, valor, saldo), formato da data, tipo de conta, inverter sinais e ignorar linhas (cabeçalhos/rodapés). O layout fica **memorizado** (impressão digital = cabeçalho da tabela + prefixo do IBAN / topo da página; só colunas e formatos, nunca texto do extrato) e os extratos seguintes do mesmo banco usam-no automaticamente. O mesmo para CSV/Excel («Apliquei o mapeamento guardado»). Os layouts guardados listam-se (e esquecem-se) no ecrã inicial de Importar.
- **Limites do PDF/OCR**: cada banco é diferente — o leitor genérico foi validado com ficheiros sintéticos (`tests/fixtures/generate-pdf.mjs`) e com um extrato real de um banco verificado localmente (fora do repositório), **não** com extratos reais de outros bancos. Linhas com a data fora do início, tabelas sem colunas alinhadas, extratos com colunas coladas, valores sem decimais, ou a descrição antes da data podem falhar (use o ajuste manual ou CSV/OFX). O OCR depende da qualidade da imagem (limite: 12 páginas) e pode trocar dígitos — a cadeia de saldos ajuda a detetá-lo, mas reveja sempre. A IA pode errar ou omitir linhas; nunca é usada sem a sua confirmação.
- Transferências só são emparelhadas dentro da mesma importação; moedas que não EUR só geram aviso; cabeçalhos de várias linhas não são suportados; a deteção de duplicados exige a mesma data.
- Anular uma importação mantém a conta criada se já tiver movimentos de outra origem.

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
npm test                           # tests/e2e.mjs + tests/import.e2e.mjs + tests/generic.e2e.mjs
npm run test:import                # só a importação de extratos
npm run test:generic               # só o leitor genérico de PDF/imagem (layouts, OCR, ajuste manual, IA simulada)
npm run test:card                  # só os extratos de cartão de crédito (PDF sintético) e o ecrã «Ajustar leitura» sem linhas
npm run fixtures                   # regenera tests/fixtures (dados fictícios)
```
`e2e.mjs` cobre todos os módulos, OCR com um talão sintético, exportar/importar, tema, offline e erros de consola. `import.e2e.mjs` cobre a importação (CSV/XLSX/XLS/OFX/QIF/PDF, mapeamento, contas, duplicados, anular, categorias, transferências, migração v2→v3, offline). `generic.e2e.mjs` cobre o leitor genérico com 19 PDFs/imagens sintéticos (débito/crédito, valor único, `dd-mm` sem ano, inglês, espanhol, várias contas, cartão, digitalizados por OCR, margem rodada/cabeçalhos repetidos, ficheiro que não é extrato), o passo «Ajustar leitura», a memória de layouts (PDF e CSV) e a IA com endpoint simulado. `card.e2e.mjs` cobre os extratos de cartão (PDF sintético anonimizado: datas `dd.mm`, `,30EUR`, comissões/impostos sem data, juros só com data valor, resumo da página 1, «Detalhe dos pagamentos», cabeçalhos repetidos/indentação diferente, viragem de ano), a continuidade entre extratos mensais, as transferências cartão↔conta à ordem e o ecrã de ajuste quando não há linhas.

## Estrutura

```
public/                 código-fonte da app (HTML/CSS/JS sem framework)
  index.html, manifest.webmanifest, sw.js
  css/app.css
  js/main.js            router + navegação (registo de módulos)
  js/db.js              IndexedDB, estado, exportar/importar
  js/model.js           saldos, dívidas, combustível, garantias, preços
  js/modules/*.js       um ficheiro por separador
  js/modules/importar.js  assistente de importação de extratos
  js/import/              parse.js (CSV/OFX/QIF, números, datas, IBAN), tokens.js + layout.js (leitor genérico de tabelas), cardstatement.js (cartões de crédito), pdfstatement.js
                          (orquestração PDF/imagem, confiança, layouts memorizados), ai.js (IA opcional), categorize.js,
                          loaders.js (SheetJS, pdf.js, OCR), engine.js (contas, duplicados, transferências, gravar/anular), sample.js
  js/ocr.js, receipt-parser.js, image.js, charts.js, ui.js, util.js, demo.js
  vendor/tesseract/     motor OCR + dados de português (local, funciona offline)
  vendor/xlsx/          SheetJS 0.18.5 (Apache-2.0), carregado a pedido
  vendor/pdfjs/         pdf.js 5.6.205 (Apache-2.0), carregado a pedido
scripts/build.mjs       public/ → dist/ + pré-cache do service worker
scripts/serve.mjs       servidor estático mínimo
tests/e2e.mjs           teste ponta-a-ponta (Playwright)
tests/import.e2e.mjs    teste da importação de extratos
tests/generic.e2e.mjs   teste do leitor genérico de PDF/imagem
tests/card.e2e.mjs      teste dos extratos de cartão de crédito
tests/fixtures/         extratos fictícios (CSV, XLSX, XLS, OFX, QIF, PDF, imagens) + generate.mjs, generate-pdf.mjs
```

### Modelo de dados (v3, esquema `financas-pessoais`)
Valores em **cêntimos**; datas `AAAA-MM-DD` (apresentadas `dd/mm/aaaa`); fotos em Blob na store `images`.
Coleções: `accounts`, `categories`, `movements` (entrada | saida | transferencia), `debts`, `debtPayments`, `vehicles`, `fuel`, `warranties`, `receipts`, `prices`, mais `settings`. **v2** acrescenta `categories[].orcamento` (cêntimos/mês, só categorias de saída; `null` = sem orçamento); `migrate()` em `db.js` converte dados v1 ao abrir. **v3** acrescenta as coleções `imports` (histórico) e `catRules` (categorias aprendidas), `accounts[].iban/chaves/importId` e `movements[].importId/extId`; a migração é automática. Registos ligados (pagamento de dívida, abastecimento, talão) guardam `movId` do movimento que geraram. Para acrescentar um módulo: criar `js/modules/xxx.js` (`{id, titulo, icone, render, mount}`), juntá-lo à lista em `main.js` e, se precisar de dados, acrescentar a coleção em `db.js` (`COLLS`) — a exportação/importação passa a incluí-la.

## Privacidade
Nada sai do dispositivo (a importação de extratos é feita localmente), exceto se ativar o assistente com IA online (envia a pergunta e um resumo do mês ao serviço escolhido; a chave de API fica só no dispositivo e não entra na cópia de segurança).
Os dados vivem no armazenamento do navegador: **faça cópias de segurança regulares** (Definições → Exportar).
