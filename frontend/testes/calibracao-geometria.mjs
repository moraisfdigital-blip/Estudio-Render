/**
 * Prova que o diálogo de calibração grava o pixel certo em qualquer janela.
 *
 * O defeito que este teste tranca: a foto é encaixada na caixa com
 * `object-contain`, e quando `max-h-[62vh]` corta a altura sobram tarjas nas
 * laterais. Se a conta do clique ignorar as tarjas, o ponto gravado não é o
 * ponto que o usuário mirou — e o erro só aparece em janela baixa, o que faz
 * dele um defeito que passa despercebido em desenvolvimento e morde em campo.
 * Medido antes da correção: até 353 px de desvio numa foto de 1600 px (~22%).
 *
 * Método: clicamos em dois pontos de coordenada conhecida da foto, calculados
 * a partir do encaixe real, e conferimos o que o diálogo diz ter gravado. A
 * janela mais baixa da lista existe justamente para forçar a tarja a aparecer.
 *
 * Como rodar (precisa de backend, banco e Vite no ar):
 *   APP_URL=http://localhost:5173 EMAIL=... SENHA=... node frontend/testes/calibracao-geometria.mjs
 */
import { chromium } from 'playwright'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const EMAIL = process.env.EMAIL
const SENHA = process.env.SENHA
const PROJETO = process.env.PROJETO
if (!EMAIL || !SENHA || !PROJETO) {
  console.error('Defina EMAIL, SENHA e PROJETO (id de um projeto que tenha foto).')
  process.exit(2)
}

// Alturas propositalmente diferentes: a última força o corte de `max-h-[62vh]`.
const JANELAS = [
  { width: 1500, height: 1000 },
  { width: 1500, height: 760 },
  { width: 1500, height: 560 },
]
const TOLERANCIA = 6 // px da foto — um clique inteiro de folga

const navegador = await chromium.launch({ channel: 'chrome' })
const resultados = []
const erros = []

for (const janela of JANELAS) {
  const contexto = await navegador.newContext({ viewport: janela })
  const pagina = await contexto.newPage()
  pagina.on('pageerror', (e) => erros.push(`${janela.height}px: exceção ${e.message}`))

  await pagina.goto(APP, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', EMAIL)
  await pagina.fill('input[type="password"]', SENHA)
  await pagina.click('button[type="submit"]')
  await pagina.waitForSelector('aside', { timeout: 15000 })

  // O projeto é indicado por variável: o teste não adivinha qual dos projetos
  // do ambiente tem foto, e apontar para um fixo no código deixaria o teste
  // mentindo em qualquer máquina que não a de quem o escreveu.
  await pagina.goto(`${APP}/projeto/${PROJETO}/levantamento`, { waitUntil: 'networkidle' })
  await pagina.waitForTimeout(1200)

  // As fotos ficam dentro da área; abrir a área é parte do caminho real.
  const abrirArea = pagina.getByRole('button', { name: 'Abrir' })
  if (await abrirArea.count()) {
    await abrirArea.first().click()
    await pagina.waitForTimeout(1200)
  }

  if (!(await pagina.getByRole('button', { name: /Calibrar escala|Conferir escala/ }).count())) {
    erros.push(`${janela.height}px: o projeto indicado não tem foto com botão de escala`)
    await contexto.close()
    continue
  }

  await pagina.getByRole('button', { name: /Calibrar escala|Conferir escala/ }).first().click()
  const foto = pagina.locator('img[alt="Foto original do levantamento"]')
  await foto.waitFor({ timeout: 15000 })
  await pagina.waitForTimeout(800)

  // Se já havia calibração, recomeça — senão o clique é ignorado de propósito.
  const remarcar = pagina.getByRole('button', { name: /Marcar de novo/ })
  if ((await remarcar.count()) && (await remarcar.first().isEnabled())) {
    await remarcar.first().click()
    await pagina.waitForTimeout(300)
  }

  const geo = await foto.evaluate((img) => {
    const r = img.getBoundingClientRect()
    const escala = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight)
    return {
      nat: { w: img.naturalWidth, h: img.naturalHeight },
      caixa: { w: Math.round(r.width), h: Math.round(r.height) },
      x: r.x + (r.width - img.naturalWidth * escala) / 2,
      y: r.y + (r.height - img.naturalHeight * escala) / 2,
      escala,
      tarja: Math.round((r.width - img.naturalWidth * escala) / 2),
    }
  })

  // Dois pontos a 1/4 e 3/4 da largura, na meia altura da foto.
  const alvos = [
    { x: Math.round(geo.nat.w * 0.25), y: Math.round(geo.nat.h * 0.5) },
    { x: Math.round(geo.nat.w * 0.75), y: Math.round(geo.nat.h * 0.5) },
  ]
  for (const alvo of alvos) {
    await pagina.mouse.click(geo.x + alvo.x * geo.escala, geo.y + alvo.y * geo.escala)
    await pagina.waitForTimeout(250)
  }

  const lido = async (rotulo) => {
    const texto = await pagina.locator(`text=${rotulo}`).first().locator('xpath=../span[2]').innerText()
    const [x, y] = texto.split(',').map((n) => Number(n.trim()))
    return { x, y }
  }
  const a = await lido('Ponto A')
  const b = await lido('Ponto B')

  const desvio = Math.max(
    Math.abs(a.x - alvos[0].x), Math.abs(a.y - alvos[0].y),
    Math.abs(b.x - alvos[1].x), Math.abs(b.y - alvos[1].y),
  )
  resultados.push({
    janela: `${janela.width}x${janela.height}`,
    caixa: `${geo.caixa.w}x${geo.caixa.h}`,
    tarja: geo.tarja,
    esperado: `${alvos[0].x},${alvos[0].y} e ${alvos[1].x},${alvos[1].y}`,
    gravado: `${a.x},${a.y} e ${b.x},${b.y}`,
    desvio,
    ok: desvio <= TOLERANCIA,
  })

  await contexto.close()
}

await navegador.close()

for (const r of resultados) {
  console.log(
    `${r.ok ? ' OK  ' : 'FALHA'} janela ${r.janela} | caixa ${r.caixa} | tarja ${r.tarja}px | esperado ${r.esperado} | gravado ${r.gravado} | desvio ${r.desvio}px`,
  )
}
if (erros.length) erros.forEach((e) => console.log('  ! ' + e))

const falhou = resultados.some((r) => !r.ok) || erros.length || resultados.length !== JANELAS.length
console.log(falhou ? '\nFALHOU' : '\nPASSOU: o ponto gravado é o ponto mirado, com e sem tarja.')
process.exit(falhou ? 1 : 0)
