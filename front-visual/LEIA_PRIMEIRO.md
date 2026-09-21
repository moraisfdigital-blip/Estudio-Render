# RENDER ARTELUX — referência do front visual para o Claude

## Objetivo deste pacote
Leia este documento e o código antes de propor mudanças. Este pacote serve para compreender e aproveitar o protótipo visual construído no ChatGPT. Não é uma ordem para iniciar, substituir o projeto atual ou refazer o planejamento.

O usuário já enviou um escopo ao Cursor e informou que o projeto está dividido em 18 fases, com Hermes na direção e Cursor conectado ao Linear e ao Orca. A lista dessas fases não foi fornecida nesta conversa. Compare esta referência com o planejamento existente; não invente as fases nem substitua decisões já aprovadas sem apresentar a divergência ao usuário.

## Identificação da referência
- Projeto: RENDER ARTELUX / ARTELUX AI DESIGN.
- Uso: ferramenta interna de comunicação visual, especialmente fachadas e postos.
- Publicação de referência: https://render-artelux.fmorais.chatgpt.site
- Versão publicada nesta conversa: 14, em 19/09/2026.
- Código incluído: revisão aa8ef1447e34929c952bf03a4ab74e4f247bd01f.
- Pacote preparado: 20/09/2026.
- Este pacote não contém o projeto que está no computador do usuário nem o conteúdo atual do Linear ou do Orca.

## Arquivos
- front/index.html: estrutura das telas e formulários.
- front/style.css: estilos iniciais e responsividade.
- front/calibration.css: levantamento, aplicação sobre foto, identidade visual final e apresentação.
- front/app.js: interações e estado do protótipo.
- front/assets/enby-pro-logo.png: logomarca utilizada no cabeçalho atual.
- front/assets/artelux-reference.png: imagem de referência disponível no projeto.

O front é HTML, CSS e JavaScript sem framework, sem instalação ou compilação. Para conhecer o visual, abra front/index.html em um navegador. Se necessário, sirva a pasta front com um servidor estático local. A pasta dist no ambiente original continha os próprios arquivos autorais; aqui ela se chama front para deixar isso claro. Não há package.json neste protótipo.

## Fluxo visual já implementado
1. Levantamento: cadastrar ou editar nome do projeto, cliente e local; adicionar várias fotos JPG, PNG ou WebP; organizar por área e selecionar uma foto.
2. Escala: marcar dois pontos sobre a fotografia, informar uma distância real, calcular uma escala de referência e salvar essa medida no estado da sessão.
3. Projeto visual: alternar entre elevação frontal e sobreposição na fotografia; editar dimensões, posição, material, acabamento, cor e texto dos elementos; adicionar, duplicar e excluir elementos.
4. Aplicação de revestimento: iniciar marcação, definir ao menos três pontos, desfazer pontos, concluir ou excluir contornos, selecionar uma superfície, escolher cor e intensidade, aplicar material e acabamento.
5. Dia/Noite: alternar a simulação visual. No modo noturno há escurecimento da fotografia; isso não corresponde a iluminação física ou renderização 3D.
6. Apresentação: exibir dados do cliente e local, foto original e simulação lado a lado, elevação e tabela de materiais, cores, dimensões e indicação de conferência. Há exportação da elevação em SVG e impressão pelo navegador, que permite salvar PDF.

As seis ações citadas no teste do usuário eram: adicionar e calibrar uma foto; abrir Projeto visual > Sobre a foto; marcar área; contornar; escolher cor; testar Dia/Noite. Elas não são as 18 fases da construção definitiva.

## Direção visual aprovada
Manter a interface clara, minimalista e profissional, com branco predominante e cores da logo em detalhes. A versão inicial estava excessivamente cinza. Primeiro foram aplicadas cores e depois, a pedido do usuário, as posições do vermelho e do verde foram invertidas.

Na versão final incluída, os botões principais e seleções principais usam verde/turquesa; outros contornos, títulos de seção e ferramentas ativas usam vermelho/rosa. O laranja permanece em destaques pontuais. A logo do arquivo é ENBY PRO, em turquesa e rosa, embora o produto seja chamado RENDER ARTELUX. Preserve o arquivo e o visual atual como referência; confirme com o usuário qualquer renomeação.

As definições finais estão no fim de calibration.css, sobrescrevendo estilos anteriores. Os nomes das variáveis --brand-green e --brand-red descrevem suas cores; a inversão foi feita nos locais de uso. Não aplique uma segunda inversão por engano. As amostras de cor dos materiais não devem mudar junto com o tema da interface.

## O que este protótipo realmente faz e seus limites
- O estado existe apenas em memória JavaScript. Atualizar ou fechar a página perde o projeto e as fotos. Salvar medida significa salvar na sessão atual, não em banco.
- As imagens enviadas usam URLs temporárias do navegador. Não há armazenamento permanente, autenticação própria ou backend.
- Baixar estudo gera um JSON parcial de referência. Ele não contém as imagens, não representa um backup completo e não tem importação correspondente.
- A escala usa uma única distância e pixels por metro. Os pontos e contornos foram corrigidos para usar coordenadas da imagem original, evitando deslocamento quando a tela muda de tamanho. Isso não resolve perspectiva, profundidade, vários planos ou reconstrução 3D.
- A elevação usa retângulos proporcionais. Material e acabamento são propriedades descritivas; não há simulação física de ACM, reflexos, relevo, letra caixa ou iluminação.
- A sobreposição usa polígonos com transparência e os elementos retangulares do estudo. Os elementos são compartilhados entre as fotos; não existe um modelo completo independente por vista.
- O controle sobre portas e janelas registra uma indicação do usuário. Não existe recorte automático. O usuário deve marcar somente o revestimento, evitando aberturas. A interface explicita essa limitação.
- A paleta ACM contém amostras ilustrativas. Não é o catálogo oficial completo nem garante fidelidade de cor física.
- A área em m², o cálculo de chapas, as perdas, os custos e o orçamento técnico não estão implementados.
- O botão de renderização 3D permanece desabilitado. Não há IA nem motor de render conectado.
- Os quatro elementos iniciais são exemplos do Posto Horizonte, não um levantamento real validado.
- O PDF usa a impressão do navegador e depende das opções de impressão. Não há geração de relatório PDF por servidor.

## Requisitos do produto definitivo discutidos
O objetivo é projetar comunicação visual sobre fotos reais respeitando estrutura existente, medidas, proporções e materiais. Portas, janelas, pilares e arquitetura devem ser preservados. Alterações precisam ser limitadas às áreas definidas pelo usuário.

O escopo discutido inclui ACM, letras caixa e iluminadas, halo, acrílico, PVC, inox, adesivos de vitrine e perfurados, painéis 3D, totens, testeiras, pórticos e iluminação. Nem todos esses componentes possuem ferramentas próprias no protótipo.

O sistema definitivo deve permitir salvar e reabrir projetos, armazenar as fotografias, tratar medidas e perspectiva, usar catálogo real, controlar áreas e aberturas, gerar apresentação realista, calcular materiais e chapas com critérios técnicos, estimar custos e produzir relatórios. Detalhes de arquitetura, provedores e sequência devem ser conciliados com as 18 fases já planejadas.

## Como usar no projeto em andamento
1. Leia o documento e inspecione os arquivos incluídos.
2. Compare o fluxo e a identidade visual com o projeto atual no Cursor.
3. Mapeie os recursos existentes e as limitações para as fases já cadastradas.
4. Reaproveite o visual e as interações aprovadas na arquitetura adotada pelo projeto; não trate este protótipo como implementação de produção concluída.
5. Apresente ao usuário um resumo curto do entendimento, das divergências e do que precisa ser incorporado. Este pacote, isoladamente, não autoriza iniciar as 18 fases, substituir arquivos ou alterar tarefas externas.

## Conferência realizada nesta conversa
Foram verificados sintaxe JavaScript, referências essenciais de arquivos e, com um ambiente simulado de DOM, inicialização, coordenadas de imagem, rejeição de pontos fora da imagem, calibração, criação de superfície, material, montagem da apresentação noturna e estado sem fotos. A publicação da versão 14 foi confirmada. Não foi realizada uma validação visual completa em navegador nesta última etapa; revise a aparência e as interações no ambiente de desenvolvimento real antes de considerar a implementação definitiva aprovada.
