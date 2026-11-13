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
  await page.locator('#m-unemployment_rate').fill('13');
  await page.locator('#m-inflation_rate').fill('2');
  await page.locator('#form-macro button[type=submit]').click();
  await expect(page.locator('#e-nome')).toHaveValue('Rascunho preservado');
  await expect(page.locator('#e-p-curricular_units_1st_sem_grade')).toHaveValue('18');
  await expect(page.locator('[data-matricula-macro=inflation_rate]')).toHaveText('2%');
  await expect(page.locator('[data-matricula-macro=unemployment_rate]')).toHaveText('13%');
  await expect(page.locator('#e-p-unemployment_rate')).toHaveCount(0);
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  expect((await alunoSalvo(page)).nome).toBe('Rascunho preservado');
  expect((await alunoSalvo(page)).unemploymentRate).toBeUndefined();
  expect(await page.evaluate(() => window.__teste.montarFeatures(window.__teste.state.alunos[0]).unemployment_rate)).toBe(13);
});

test('desemprego global substitui valores antigos e envia novas previsões para todos os alunos', async ({ page }) => {
  await cadastrar(page);
  await page.evaluate(() => {
    const aluno = window.__teste.state.alunos[0];
    localStorage.setItem('alunos-data', JSON.stringify([
      { ...aluno, unemploymentRate: 10.8, dadosPredicao: { ...aluno.dadosPredicao, unemployment_rate: 10.8 } },
      { ...aluno, id: 'aluno-c', studentId: 'ALUNO-C', nome: 'Aluno C', email: 'c@example.com', unemploymentRate: 7.6 }
    ]));
  });
  await page.reload();
  const migrados = await page.evaluate(() => window.__teste.state.alunos);
  expect(migrados).toHaveLength(2);
  for (const aluno of migrados) {
    expect(aluno.unemploymentRate).toBeUndefined();
    expect(aluno.dadosPredicao.unemployment_rate).toBeUndefined();
  }
  const consultas = [];
  await page.route('https://prediction.test/api/v1/predictions', async route => {
    const payload = route.request().postDataJSON();
    consultas.push(payload);
    await route.fulfill({ json: {
      studentId: payload.studentId,
      dropout_probability: payload.features.unemployment_rate === 13 ? 0.6 : 0.5
    } });
  });
  await page.evaluate(async () => {
    const t = window.__teste;
    t.state.apiConfig = { url: 'https://prediction.test/api/v1/predictions', token: 'test-only' };
    // Mesmo objetos ainda não migrados não podem sobrepor o indicador global.
    t.state.alunos[0].unemploymentRate = 10.8;
    t.state.alunos[1].unemploymentRate = 7.6;
    await Promise.all(t.state.alunos.map(a => t.preverRisco(a)));
  });
  expect(consultas).toHaveLength(2);
  await page.getByRole('button', { name: 'Indicadores macro', exact: true }).click();
  await page.locator('#m-unemployment_rate').fill('13');
  await page.locator('#form-macro button[type=submit]').click();
  await expect.poll(() => consultas.length).toBe(4);
  expect(new Set(consultas.slice(2).map(p => p.studentId)).size).toBe(2);
  for (const payload of consultas.slice(2)) {
    expect(payload.features).toEqual({ ...exemplo.features, unemployment_rate: 13 });
  }
  await expect(page.locator('#students-tbody')).toContainText('60%');
  await page.getByRole('button', { name: '+ Matricular aluno', exact: true }).click();
  await expect(page.locator('[data-matricula-macro=unemployment_rate]')).toHaveText('13%');
  await expect(page.locator('#f-p-unemployment_rate')).toHaveCount(0);
  await page.getByRole('button', { name: 'Preencher exemplo', exact: true }).click();
  await expect(page.locator('[data-matricula-macro=unemployment_rate]')).toHaveText('13%');
  await expect(page.locator('#toast')).toContainText('desemprego 10,8%');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.reload();
  expect(await page.evaluate(() => window.__teste.state.alunos.map(a => window.__teste.montarFeatures(a).unemployment_rate))).toEqual([13, 13]);
});

test('backup legado usa somente indicadores globais, mesmo sem valor global configurado', async ({ page }) => {
  await cadastrar(page);
  const resultado = await page.evaluate(() => {
    const t = window.__teste;
    const antigo = { ...t.state.alunos[0], unemploymentRate: 7.6 };
    antigo.dadosPredicao = { ...antigo.dadosPredicao, unemployment_rate: 7.6, inflation_rate: 3, gdp: -2 };
    const migrado = t.interpretarBackup(JSON.stringify([antigo]))[0];
    const payload = t.montarPayload(migrado);
    t.state.macro.unemployment_rate = null;
    const faltantes = t.camposFaltantes(migrado).map(c => c.chave);
    return { migrado, payload, faltantes };
  });
  expect(resultado.migrado.unemploymentRate).toBeUndefined();
  expect(resultado.migrado.dadosPredicao.unemployment_rate).toBeUndefined();
  expect(resultado.payload).toEqual(exemplo);
  expect(resultado.faltantes).toContain('unemployment_rate');
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
