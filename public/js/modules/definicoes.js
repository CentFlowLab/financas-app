import { S, save, exportData, importData, parseBackup, resetAll, SCHEMA_VERSION } from '../db.js';
import { esc, today, num } from '../util.js';
import { download, toast, confirmBox, fld, inp, sel } from '../ui.js';
import { loadDemo } from '../demo.js';

export default {
  id: 'definicoes', titulo: 'Definições', icone: 'definicoes', descricao: 'Tema, cópia de segurança',
  render() {
    const t = S.settings.tema, ia = S.settings.ia;
    const counts = `${S.movements.length} movimentos · ${S.accounts.length} contas · ${S.debts.length} dívidas · ${S.receipts.length} talões · ${S.warranties.length} garantias`;
    return `<div class="page-head"><h1 class="page-title">Definições</h1></div>
    <section class="card"><h2>Aspeto</h2><div class="seg" role="radiogroup" aria-label="Tema">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, l]) => `<label class="seg-opt"><input type="radio" name="tema" value="${v}" ${t === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></section>
    <section class="card"><h2>Cópia de segurança</h2>
      <p class="muted">Os seus dados ficam apenas neste dispositivo. Exporte regularmente uma cópia (inclui fotos de talões e garantias) e importe-a para mudar de telemóvel ou computador.</p>
      <div class="btn-row"><button class="btn primary" id="exp">⬇️ Exportar (JSON)</button><label class="btn ghost">⬆️ Importar cópia<input type="file" id="imp" accept="application/json,.json" hidden></label></div>
      <small class="muted">${counts}</small></section>
    <section class="card"><h2>Alertas</h2>${fld('Avisar garantias a expirar com (dias)', inp('alerta', S.settings.alertaGarantiaDias ?? 60, 'type="number" min="1" max="365"'))}</section>
    <section class="card"><h2>Assistente com IA online (opcional)</h2>
      <p class="muted">Por omissão o assistente funciona 100% no dispositivo. Se preencher uma chave de API (compatível com OpenAI), as perguntas e um resumo dos seus valores do mês são enviados a esse serviço. A chave fica só neste dispositivo e não é incluída na cópia de segurança.</p>
      ${fld('Endereço da API', inp('iaUrl', ia.url, 'inputmode="url"'))}${fld('Modelo', inp('iaModelo', ia.modelo))}${fld('Chave de API', inp('iaChave', ia.chave, 'type="password" autocomplete="off" placeholder="sk-…"'))}
      <button class="btn ghost small" id="ia-save">Guardar</button></section>
    <section class="card"><h2>Instalar a aplicação</h2><p class="muted">Instale no ecrã principal para usar como uma app, mesmo sem internet.</p>${window.__installEvt ? '<button class="btn primary" id="inst">📲 Instalar</button>' : '<small class="muted">No telemóvel: menu do navegador → "Adicionar ao ecrã principal". No computador: ícone de instalação na barra de endereço.</small>'}</section>
    <section class="card"><h2>Dados</h2><div class="btn-row"><button class="btn ghost" id="demo">🧪 Carregar dados de exemplo</button><button class="btn danger" id="reset">🗑️ Apagar tudo</button></div></section>
    <p class="muted center small">Finanças · versão 1.0 · esquema de dados v${SCHEMA_VERSION}</p>`;
  },
  mount(el) {
    el.querySelectorAll('[name=tema]').forEach((r) => r.addEventListener('change', () => { S.settings.tema = r.value; save('settings'); }));
    el.querySelector('#exp').addEventListener('click', async () => { download(`financas-copia-${today()}.json`, await exportData()); toast('Cópia exportada', 'ok'); });
    el.querySelector('#imp').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const data = parseBackup(await f.text());
        if (!await confirmBox('Importar esta cópia vai SUBSTITUIR todos os dados atuais. Continuar?', { okLabel: 'Substituir', danger: true })) return;
        await importData(data); toast('Cópia importada com sucesso', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    });
    el.querySelector('[name=alerta]').addEventListener('change', (e) => { const v = parseInt(e.target.value, 10); if (v > 0) { S.settings.alertaGarantiaDias = v; save('settings'); toast('Guardado', 'ok'); } });
    el.querySelector('#ia-save').addEventListener('click', () => { S.settings.ia = { url: el.querySelector('[name=iaUrl]').value.trim(), modelo: el.querySelector('[name=iaModelo]').value.trim(), chave: el.querySelector('[name=iaChave]').value.trim() }; save('settings'); toast('Definições de IA guardadas', 'ok'); });
    el.querySelector('#inst')?.addEventListener('click', async () => { const ev = window.__installEvt; ev.prompt(); await ev.userChoice; window.__installEvt = null; });
    el.querySelector('#demo').addEventListener('click', async () => { if (await confirmBox('Vai juntar movimentos, dívidas, abastecimentos, garantias e preços fictícios aos seus dados. Pode apagá-los depois com "Apagar tudo". Continuar?', { okLabel: 'Carregar' })) { await loadDemo(); toast('Dados de exemplo carregados', 'ok'); } });
    el.querySelector('#reset').addEventListener('click', async () => { if (await confirmBox('Apagar TODOS os dados deste dispositivo (movimentos, contas, dívidas, fotos…)? Esta ação não pode ser anulada. Sugestão: exporte uma cópia primeiro.', { okLabel: 'Apagar tudo', danger: true })) { await resetAll(); toast('Dados apagados'); } });
  },
};
