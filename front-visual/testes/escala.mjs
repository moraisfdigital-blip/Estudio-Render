/**
 * Prova que a calibração de escala do protótipo dá o mesmo resultado correto
 * em qualquer tamanho de janela.
 *
 * O bug corrigido era silencioso: nenhum erro no console, só um número errado.
 * Ele aparecia porque o clique era convertido em pixels da foto usando uma
 * caixa (o palco) diferente daquela onde a foto realmente era desenhada. Como
 * as duas caixas mudam de proporção conforme a janela, o erro variava com o
 * tamanho da tela — a mesma foto calibrada em duas janelas dava escalas
 * diferentes. Por isso o teste roda em vários tamanhos e exige o MESMO número.
 *
 * Método: uma foto de 1600x1200 px. Clicamos em dois pontos separados por
 * exatamente 800 px da foto e declaramos que valem 8 m. A escala correta é,
 * portanto, 100,0 pixels por metro — em toda janela.
 *
 * Como rodar (o Playwright vive fora do repositório, junto do Chrome do sistema):
 *   npx playwright@latest --version   # ou use a instalação já existente
 *   node front-visual/testes/escala.mjs
 * Precisa de um servidor estático servindo front-visual/front em 127.0.0.1:5500.
 */
import { chromium } from 'playwright'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG_1600x1200 } from './foto.mjs'

const BASE = process.env.PROTOTIPO_URL ?? 'http://127.0.0.1:5500/index.html'

const FOTO_W = 1600
const FOTO_H = 1200
const PIXEL_A = 240 // pixel horizontal do primeiro clique, na foto original
const PIXEL_B = 1040 // 800 px depois
const METROS = 8
const ESPERADO = (PIXEL_B - PIXEL_A) / METROS // 100,0 px/m
const TOLERANCIA = 1.5 // px/m — folga para o arredondamento de um clique inteiro

// Tamanhos deliberadamente diferentes em proporção: retrato, quadrado, wide.
const JANELAS = [
  { width: 1600, height: 1000 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1100, height: 1300 },
  { width: 1440, height: 720 },
]

const pasta = mkdtempSync(join(tmpdir(), 'escala-'))
const caminhoFoto = join(pasta, 'foto.png')
writeFileSync(caminhoFoto, Buffer.from(PNG_1600x1200, 'base64'))

const navegador = await chromium.launch({ channel: 'chrome' })
const resultados = []
const avisos = []

for (const janela of JANELAS) {
  const contexto = await navegador.newContext({ viewport: janela })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') avisos.push(`${janela.width}x${janela.height}: ${m.text()}`)
  })

  await pagina.goto(BASE, { waitUntil: 'networkidle' })
  await pagina.setInputFiles('#photoInput', caminhoFoto)
  await pagina.waitForSelector('#calibrationStage', { state: 'visible' })
  await pagina.locator('#calibrationStage').scrollIntoViewIfNeeded()
  await pagina.waitForTimeout(400)

  // A caixa de referência é a da FOTO renderizada — é o que o usuário vê e
  // onde ele mira o clique. Medir pelo overlay faria o teste concordar com o
  // próprio defeito (foi o que aconteceu na primeira versão deste teste) e
  // passar mesmo no código errado.
  const caixa = await pagina.locator('#surveyPhoto').boundingBox()
  const escala = Math.min(caixa.width / FOTO_W, caixa.height / FOTO_H)
  const margemX = caixa.x + (caixa.width - FOTO_W * escala) / 2
  const margemY = caixa.y + (caixa.height - FOTO_H * escala) / 2
  const emTela = (px, py) => [margemX + px * escala, margemY + py * escala]

  for (const px of [PIXEL_A, PIXEL_B]) {
    const [cx, cy] = emTela(px, FOTO_H / 2)
    await pagina.mouse.click(cx, cy)
    await pagina.waitForTimeout(150)
  }

  await pagina.fill('#referenceDistance', String(METROS))
  await pagina.click('#calibrate')
  await pagina.waitForTimeout(250)

  // Lê o valor de verdade guardado pela aplicação, não o texto arredondado.
  const obtido = await pagina.evaluate(() => {
    const el = document.querySelector('#calibrationResult')
    const m = el.textContent.match(/([\d.,]+)\s*pixels por metro/)
    return m ? Number(m[1].replace(',', '.')) : null
  })

  const erro = obtido === null ? Infinity : Math.abs(obtido - ESPERADO)
  const ok = erro <= TOLERANCIA
  resultados.push({ janela: `${janela.width}x${janela.height}`, obtido, esperado: ESPERADO, erroPct: obtido ? ((obtido - ESPERADO) / ESPERADO) * 100 : null, ok })

  await contexto.close()
}

await navegador.close()

console.log('\n janela        obtido     esperado   erro')
for (const r of resultados) {
  console.log(
    `${r.ok ? ' OK ' : 'FALHA'} ${r.janela.padEnd(11)} ${String(r.obtido).padEnd(10)} ${r.esperado.toFixed(1).padEnd(10)} ${r.erroPct === null ? '—' : r.erroPct.toFixed(2) + '%'}`,
  )
}

// Segunda garantia: além de estarem certos, os valores têm de ser iguais entre si.
const valores = resultados.map((r) => r.obtido).filter((v) => typeof v === 'number')
const espalhamento = Math.max(...valores) - Math.min(...valores)
console.log(`\nvariação entre janelas: ${espalhamento.toFixed(2)} px/m (tem de ser ~0)`)
if (avisos.length) {
  console.log('\navisos do console:')
  avisos.forEach((a) => console.log('  ! ' + a))
}

const falhas = resultados.filter((r) => !r.ok)
if (falhas.length || espalhamento > TOLERANCIA) {
  console.error(`\nFALHOU: ${falhas.length} janela(s) fora da tolerância; variação ${espalhamento.toFixed(2)} px/m`)
  process.exit(1)
}
console.log('\nPASSOU: a escala é a mesma e está correta em todas as janelas testadas.')
