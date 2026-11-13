const { test, expect } = require('@playwright/test');
const exemplo = require('../docs/payload-exemplo.json');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test.beforeEach(async ({ page }) => {
  // Nenhum teste usa credenciais ou a API real.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.protocol === 'file:' ? route.continue() : route.abort();
  });
  await page.addInitScript(() => { window.__EXPOR_TESTE__ = true; });
  await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
});

async function cadastrar(page, completo = true) {
  await page.getByRole('button', { name: '+ Matricular aluno', exact: true }).click();
  if (completo) await page.getByRole('button', { name: 'Preencher exemplo', exact: true }).click();
  await page.locator('#f-nome').fill('Aluno de teste');
  await page.locator('#f-email').fill('teste@example.com');
  if (!completo) {
    await page.locator('#f-curso').selectOption({ index: 1 });
    await page.locator('#f-turno').selectOption('Diurno');
  }
  await page.getByRole('button', { name: 'Salvar matrícula', exact: true }).click();
  await expect(page.locator('#modal-overlay')).toBeHidden();
}

async function alunoSalvo(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('alunos-data'))[0]);
}

test('matrícula e edição preservam os 34 atributos e a mesma organização', async ({ page }, testInfo) => {
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await page.getByRole('button', { name: '+ Matricular aluno', exact: true }).click();
  const secoes = await page.locator('#modal-box legend').allTextContents();
  const campos = await page.locator('#modal-box input, #modal-box select').evaluateAll(els => els.map(e => e.id.slice(2)));
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await cadastrar(page);
  expect(await page.evaluate(() => window.__teste.montarPayload(window.__teste.state.alunos[0]))).toEqual(exemplo);
  await page.getByRole('button', { name: 'Editar dados', exact: true }).click();
  expect(await page.locator('#modal-box legend').allTextContents()).toEqual(secoes);
  expect(await page.locator('#modal-box input, #modal-box select').evaluateAll(els => els.map(e => e.id.slice(2)))).toEqual(campos);
  await expect(page.locator('#e-p-educational_special_needs')).toHaveValue('0');
  await expect(page.locator('#e-turno')).toHaveValue('Diurno');
  await page.screenshot({ path: testInfo.outputPath('edicao-desktop.png') });
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  expect(await page.evaluate(() => window.__teste.montarPayload(window.__teste.state.alunos[0]))).toEqual(exemplo);
  expect(erros).toEqual([]);
});

test('edição recalcula indicadores, mantém frequência e persiste após recarregar', async ({ page }) => {
  await cadastrar(page);
  const id = (await alunoSalvo(page)).id;
  await page.getByRole('button', { name: 'Editar dados', exact: true }).click();
  await page.locator('#e-freq').fill('82.5');
  for (const sem of ['1st', '2nd']) {
    await page.locator(`#e-p-curricular_units_${sem}_sem_approved`).fill('0');
    await page.locator(`#e-p-curricular_units_${sem}_sem_grade`).fill('0');
  }
  await page.locator('#e-turno').selectOption('Noturno');
  await expect(page.locator('#e-media')).toHaveValue('0');
  await expect(page.locator('#e-reprovadas')).toHaveValue('12');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  expect(await alunoSalvo(page)).toMatchObject({ id, media: 0, disciplinasReprovadas: 12, frequencia: 82.5, turno: 'Noturno' });
  await page.reload();
  await page.getByRole('button', { name: 'Editar aluno', exact: true }).click();
  await expect(page.locator('#e-freq')).toHaveValue('82.5');
  await expect(page.locator('#e-media')).toHaveValue('0');
  await expect(page.locator('#e-turno')).toHaveValue('Noturno');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  const features = await page.evaluate(() => window.__teste.montarFeatures(window.__teste.state.alunos[0]));
  expect(Object.keys(features)).toHaveLength(34);
  expect(features.daytime_evening_attendance).toBe(0);
});

test('cadastro incompleto mantém indicadores pendentes e não inventa frequência', async ({ page }) => {
  await cadastrar(page, false);
  expect(await alunoSalvo(page)).toMatchObject({ media: null, disciplinasReprovadas: null, frequencia: null });
  await page.getByRole('button', { name: 'Editar dados', exact: true }).click();
  await page.locator('#e-p-curricular_units_1st_sem_grade').fill('16');
  await expect(page.locator('#e-media')).toHaveValue('');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  expect(await alunoSalvo(page)).toMatchObject({ media: null, disciplinasReprovadas: null });
  expect(await page.evaluate(() => window.__teste.camposFaltantes(window.__teste.state.alunos[0]).length)).toBeGreaterThan(0);
});

test('configuração macro retorna à edição sem perder o rascunho', async ({ page }) => {
  await cadastrar(page);
  await page.getByRole('button', { name: 'Editar dados', exact: true }).click();
  await page.locator('#e-nome').fill('Rascunho preservado');
  await page.locator('#e-p-curricular_units_1st_sem_grade').fill('18');
  await page.getByRole('button', { name: 'Configurar indicadores globais', exact: true }).click();
  await page.locator('#m-inflation_rate').fill('2');
  await page.locator('#form-macro button[type=submit]').click();
  await expect(page.locator('#e-nome')).toHaveValue('Rascunho preservado');
  await expect(page.locator('#e-p-curricular_units_1st_sem_grade')).toHaveValue('18');
  await expect(page.locator('[data-matricula-macro=inflation_rate]')).toHaveText('2%');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  expect((await alunoSalvo(page)).nome).toBe('Rascunho preservado');
});

test('duplicidade, limites numéricos e falha de armazenamento não alteram os dados', async ({ page }) => {
  await cadastrar(page);
  const original = await alunoSalvo(page);
  await page.evaluate(() => {
    const t = window.__teste;
    t.state.alunos.push({ ...t.state.alunos[0], id: 'outro', email: 'outro@example.com' });
    t.salvarDados();
  });
  await page.getByRole('button', { name: 'Editar dados', exact: true }).click();
  await page.locator('#e-email').fill('OUTRO@example.com');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('já pertence');
  expect(await alunoSalvo(page)).toEqual(original);
  await page.locator('#e-email').fill(original.email);
  await page.locator('#e-p-curricular_units_1st_sem_grade').fill('21');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.locator('#modal-overlay')).toBeVisible();
  expect(await alunoSalvo(page)).toEqual(original);
  await page.locator('#e-p-curricular_units_1st_sem_grade').fill('18');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); }; });
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.locator('#modal-overlay')).toBeVisible();
  expect(await alunoSalvo(page)).toEqual(original);
  expect(await page.evaluate(() => window.__teste.state.alunos[0])).toEqual(original);
});

test('formulários funcionam em tela de celular sem transbordamento', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await cadastrar(page);
  await page.getByRole('button', { name: 'Editar dados', exact: true }).click();
  expect(await page.locator('#modal-box').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator('#e-p-curricular_units_2nd_sem_grade').fill('20');
  await expect(page.locator('#e-media')).toHaveValue('8.4');
  await page.locator('#e-media').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('edicao-celular.png') });
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  expect((await alunoSalvo(page)).media).toBe(8.4);
});
