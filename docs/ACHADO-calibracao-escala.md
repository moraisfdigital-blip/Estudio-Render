# Achado: a escala de calibração saía errada e o erro mudava com a janela

Data: 20/09/2026 · Encontrado durante a análise do protótipo `front-visual/front`.

## O que acontecia, em uma frase

Você clicava em dois pontos da foto, dizia "isso aqui tem 8 metros", e o sistema
gravava uma escala **23% menor** do que a verdadeira. Pior: se você abrisse a
mesma foto numa janela de outro tamanho e calibrasse de novo, saía **outro
número**. Nenhum erro aparecia no console — só uma medida errada, silenciosa,
que depois contaminava a elevação, a área em m² e a apresentação.

## Por que acontecia

Três caixas estão envolvidas quando você clica numa foto:

1. o **palco** (a moldura cinza);
2. a **foto desenhada** dentro dele;
3. a **camada de marcação** (um SVG transparente por cima), que é onde os
   pontinhos e a linha aparecem.

A conta que transforma "onde o mouse clicou" em "qual pixel da foto" precisa
usar exatamente a mesma caixa em que a foto aparece. O código media o **palco**,
mas uma regra de CSS (`#surveyPhoto{max-height:420px}`) encolhia a **foto** para
dentro dele. Resultado: o clique era traduzido para um pixel diferente daquele
que o usuário estava mirando.

Com foto de 1600×1200 e palco de 730×574, a foto era desenhada em 560×420. A
razão 560/730 = 0,767 é exatamente o fator do erro medido: 76,7 px/m onde o
correto era 100,0 px/m. Como as duas caixas mudam de proporção conforme a
janela, o erro variava: −23,3%, −26,8%, −5,7% ou 0%, dependendo do tamanho.

## A correção

Duas mudanças pequenas em `front-visual/front`:

- `style.css` — `#surveyPhoto` deixou de ter `max-height:420px` e passou a
  `height:100%`, igual à regra de classe. A foto volta a ocupar a mesma caixa do
  palco e da camada de marcação. (O palco de composição já era assim; era só o
  de calibração que destoava.)
- `app.js` — `imagePoint()` passou a medir explicitamente a camada onde o
  desenho acontece, em vez de confiar em qual elemento recebeu o clique. E, se
  um dia o CSS voltar a descasar as caixas, ela agora **avisa no console** com
  os dois tamanhos. A falha era silenciosa; agora não é mais.

## A prova

`front-visual/testes/escala.mjs` clica em dois pontos separados por exatamente
800 pixels da foto, declara 8 metros e exige 100,0 px/m — em cinco janelas de
proporções diferentes (retrato, quadrada, wide). Os pontos de clique são
calculados a partir da **foto renderizada**, não da camada de marcação: essa
distinção é o que faz o teste valer alguma coisa.

Primeira versão do teste media pela camada de marcação e **passava até no código
defeituoso**, porque concordava com o próprio erro. Corrigido, o resultado é:

```
versão com o bug                    versão corrigida
FALHA 1600x1000   76.7  (-23,30%)    OK  1600x1000   99.9  (-0,10%)
 OK   1280x900   100.0  ( 0,00%)     OK  1280x900   100.2  ( 0,20%)
FALHA 1920x1080   73.2  (-26,80%)    OK  1920x1080  100.1  ( 0,10%)
 OK   1100x1300  100.0  ( 0,00%)     OK  1100x1300  100.3  ( 0,30%)
FALHA 1440x720    94.3  ( -5,70%)    OK  1440x720   100.2  ( 0,20%)
variação: 26,80 px/m                 variação: 0,40 px/m
```

Como rodar: com `front-visual/front` servido em `127.0.0.1:5500`,
`node front-visual/testes/escala.mjs`. Usa Playwright com o Chrome do sistema.

## O mesmo defeito existe no projeto React — latente

`frontend/src/components/CalibrationDialog.tsx` e `MasksDialog.tsx` medem a
caixa certa (a da `<img>`), mas convertem o clique **linearmente** sobre ela,
sem descontar a tarja preta que o `object-contain` cria. Enquanto a caixa tiver
a mesma proporção da foto, dá na mesma. Quando `max-h-[62vh]` corta a altura —
janela baixa, notebook de tela curta, ou foto em pé — a proporção muda e as
contas divergem. Medido numa réplica isolada da geometria, com foto 1600×1200:

| janela      | caixa da `<img>` | pixel que o React lê | pixel onde o SVG desenha | divergência |
|-------------|------------------|----------------------|--------------------------|-------------|
| 1400 × 1000 | 700 × 525        | 1200                 | 1200                     | 0 px        |
| 1400 × 600  | 700 × 372        | 1200                 | 1365                     | −165 px     |
| 1400 × 450  | 700 × 279        | 1200                 | 1553                     | −353 px     |

353 px de 1600 são ~22% — a mesma ordem de grandeza do bug do protótipo. Não foi
corrigido: depende de autorização, por ser mudança no projeto oficial.

## Dados de demonstração

No mesmo passe, "Posto Horizonte" (cliente fictício) e os quatro elementos
pré-carregados do protótipo passaram a se identificar como DEMONSTRAÇÃO na tela
e no código. O projeto React nunca teve esses dados.
