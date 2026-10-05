const $ = (selector) => document.querySelector(selector);

// Elementos de demonstração. Todas as medidas abaixo são inventadas para o
// protótipo abrir com algo desenhado — nenhuma veio de levantamento real.
// 'confirmed: false' já marca cada uma como não conferida.
const objects = [
  { name: 'Testeira principal', type: 'Revestimento', width: 12.4, height: 1.2, x: 0, y: 4.1, color: '#737b80', material: 'ACM', finish: 'Fosco', label: 'HORIZONTE', confirmed: false },
  { name: 'Pilar esquerdo', type: 'Revestimento de pilar', width: .55, height: 4.1, x: .7, y: 0, color: '#d7d9d9', material: 'ACM', finish: 'Fosco', label: '', confirmed: false },
  { name: 'Pilar direito', type: 'Revestimento de pilar', width: .55, height: 4.1, x: 11.15, y: 0, color: '#d7d9d9', material: 'ACM', finish: 'Fosco', label: '', confirmed: false },
  { name: 'Totem de identificação', type: 'Sinalização', width: 1.35, height: 4.3, x: 13.6, y: 0, color: '#424b53', material: 'ACM', finish: 'Fosco', label: 'HORIZONTE', confirmed: false }
];

const colors = [
  ['Branco', '#eceeec'],
  ['Prata', '#d7d9d9'],
  ['Cinza', '#737b80'],
  ['Grafite', '#424b53'],
  ['Preto', '#282b2f']
];

const catalogColors = [
  ['Branco', '#eef0ee'],
  ['Prata', '#c8cccd'],
  ['Grafite', '#41464a'],
  ['China Red', '#b82027'],
  ['Yellow', '#f2c51f'],
  ['Orange', '#e76b22'],
  ['Dark Green', '#17533c'],
  ['Blue GM', '#174d82'],
  ['Green Apple', '#66a93f']
];

let selected = 0;
let showDimensions = true;
let zoom = 100;
// Dados de demonstração — 'Posto Horizonte' é um cliente fictício, criado só
// para o protótipo ter algo na tela. Nenhum projeto real depende deste bloco:
// 'Novo projeto' substitui tudo. O rótulo DEMONSTRAÇÃO fica visível de
// propósito, para ninguém confundir com um levantamento de verdade.
let projectData = {
  name: 'DEMONSTRAÇÃO · Posto Horizonte (cliente fictício)',
  client: 'DEMONSTRAÇÃO · Posto Horizonte (cliente fictício)',
  location: ''
};
let areaNames = ['Fachada principal', 'Lateral', 'Totem e acesso'];
let photos = [];
let activePhotoId = null;
let overlayOpacity = 82;
let activeView = 'elevation';
let dragState = null;
let surfaceDrawing = false;
let surfacePoints = [];
let selectedSurfaceId = null;
let selectedSurfaceColor = catalogColors[0][1];
let selectedSurfaceName = catalogColors[0][0];
let surfaceOpacity = 74;
let lightMode = 'day';

const activePhoto = () => photos.find((photo) => photo.id === activePhotoId) || null;
const activeSurface = () => {
  const photo = activePhoto();
  return photo ? (photo.surfaces || []).find((surface) => surface.id === selectedSurfaceId) || null : null;
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => $('#toast').classList.remove('visible'), 3000);
}

function syncProjectUI() {
  $('#projectName').value = projectData.name;
  $('#projectMeta').textContent = projectData.client + (projectData.location ? ' · ' + projectData.location : ' · local não informado');
  $('#surveyProjectTitle').textContent = projectData.client;
  $('#surveyProjectMeta').textContent = projectData.location || 'Endereço ou unidade ainda não informado.';
}

function openProjectDialog(blank = false) {
  $('#projectDialog').dataset.mode = blank ? 'new' : 'edit';
  $('#dialogProjectName').value = blank ? '' : projectData.name;
  $('#clientName').value = blank ? '' : projectData.client;
  $('#siteLocation').value = blank ? '' : projectData.location;
  $('#projectDialog').showModal();
  requestAnimationFrame(() => $('#dialogProjectName').focus());
}

function renderPhotoLibrary() {
  const selectedArea = $('#uploadArea').value;
  $('#uploadArea').innerHTML = areaNames.map((area) => '<option>' + escapeHtml(area) + '</option>').join('');
  if (areaNames.includes(selectedArea)) $('#uploadArea').value = selectedArea;
  $('#uploadBox').hidden = photos.length > 0;
  $('#photoAreas').innerHTML = areaNames.map((area) => {
    const areaPhotos = photos.filter((photo) => photo.area === area);
    return '<section class="area-group"><div class="area-group-head"><div><b>' + escapeHtml(area) + '</b><small>' + areaPhotos.length + (areaPhotos.length === 1 ? ' foto' : ' fotos') + '</small></div><button type="button" data-add-to-area="' + escapeHtml(area) + '">＋ Foto</button></div><div class="photo-strip">' + (areaPhotos.length ? areaPhotos.map((photo) => '<button type="button" class="photo-card ' + (photo.id === activePhotoId ? 'active' : '') + '" data-photo-id="' + photo.id + '"><img src="' + photo.url + '" alt=""><span><b>' + escapeHtml(photo.name) + '</b><small class="' + (photo.saved ? 'saved' : '') + '">' + (photo.saved ? 'Medida salva' : photo.pixelsPerMeter ? 'Escala calculada' : 'Sem escala') + '</small></span></button>').join('') : '<div class="area-empty">Nenhuma imagem nesta área</div>') + '</div></section>';
  }).join('');
  updateProgress('survey');
}

function loadActivePhoto(photoId) {
  const photo = photos.find((item) => item.id === photoId);
  if (!photo) return;
  if (!photo.surfaces) photo.surfaces = [];
  activePhotoId = photo.id;
  selectedSurfaceId = photo.surfaces[0]?.id || null;
  surfaceDrawing = false;
  surfacePoints = [];
  $('#surveyPhoto').src = photo.url;
  $('#compositionPhoto').src = photo.url;
  $('#activePhotoName').textContent = photo.name;
  $('#activePhotoArea').textContent = photo.area;
  $('#referenceDistance').value = photo.referenceDistance || 12.4;
  $('#calibration').hidden = false;
  $('#calibrationResult').innerHTML = photo.pixelsPerMeter ? '<b>Escala definida</b><br>' + photo.pixelsPerMeter.toFixed(1) + ' pixels por metro · referência de ' + Number(photo.referenceDistance).toFixed(2) + ' m' : 'A escala ainda não foi definida.';
  $('#saveMeasurement').disabled = !photo.pixelsPerMeter;
  $('#usePhoto').disabled = !photo.saved;
  $('#stageHint').textContent = photo.saved ? 'Medida salva para esta fotografia' : photo.points.length === 2 ? 'Informe a distância real e calibre' : 'Clique no primeiro ponto da medida conhecida';
  renderPhotoLibrary();
  requestAnimationFrame(() => {
    drawCalibration();
    drawPhotoOverlay();
    syncSurfaceUI();
  });
}

function renderCatalog() {
  $('#catalogColors').innerHTML = catalogColors.map(([name, color]) =>
    '<button type="button" data-catalog-color="' + color + '" data-catalog-name="' + escapeHtml(name) + '" class="' + (color === selectedSurfaceColor ? 'selected' : '') + '" title="' + escapeHtml(name) + '"><span style="background:' + color + '"></span><small>' + escapeHtml(name) + '</small></button>'
  ).join('');
  $('#catalogColorDot').style.background = selectedSurfaceColor;
  $('#catalogColorName').textContent = selectedSurfaceName;
}

function syncSurfaceUI() {
  const photo = activePhoto();
  const surface = activeSurface();
  const hasPhoto = Boolean(photo && photo.saved);
  $('#markSurface').disabled = !hasPhoto;
  $('#finishSurface').disabled = !surfaceDrawing || surfacePoints.length < 3;
  $('#undoSurface').disabled = !surfaceDrawing || surfacePoints.length === 0;
  $('#clearSurface').disabled = !surfaceDrawing && !surface;
  $('#applySurface').disabled = !surface;
  $('#newSurface').disabled = !hasPhoto;
  $('#markSurface').classList.toggle('active-tool', surfaceDrawing);
  if (!photo) {
    $('#surfaceStatus').textContent = 'Adicione uma fotografia no levantamento';
    $('#surfaceArea').textContent = 'Aguardando fotografia';
  } else if (!photo.saved) {
    $('#surfaceStatus').textContent = 'Calibre e salve a medida da fotografia';
    $('#surfaceArea').textContent = 'Escala ainda não salva';
  } else if (surfaceDrawing) {
    $('#surfaceStatus').textContent = surfacePoints.length < 3 ? 'Marque pelo menos 3 cantos da superfície' : surfacePoints.length + ' pontos marcados · conclua o contorno';
    $('#surfaceArea').textContent = surfacePoints.length + ' pontos no contorno';
  } else if (surface) {
    $('#surfaceStatus').textContent = 'Área selecionada · escolha o acabamento';
    $('#surfaceArea').textContent = surface.points.length + ' pontos · escala da foto preservada';
    $('#surfaceTitle').textContent = surface.name;
    selectedSurfaceColor = surface.color;
    selectedSurfaceName = surface.colorName;
    surfaceOpacity = surface.opacity;
    $('#surfaceOpacity').value = surfaceOpacity;
    $('#surfaceOpacityValue').value = surfaceOpacity + '%';
    $('#surfaceMaterial').value = surface.material;
    $('#surfaceFinish').value = surface.finish;
    $('#preserveOpenings').checked = surface.preserveOpenings;
  } else {
    $('#surfaceStatus').textContent = 'Clique em “Marcar área” e contorne a superfície';
    $('#surfaceArea').textContent = 'Aguardando contorno';
    $('#surfaceTitle').textContent = 'Nova área de ACM';
  }
  renderCatalog();
}

function beginSurfaceDrawing() {
  const photo = activePhoto();
  if (!photo || !photo.saved) {
    notify('Primeiro calibre e salve a medida da fotografia.');
    return;
  }
  surfaceDrawing = true;
  surfacePoints = [];
  selectedSurfaceId = null;
  syncSurfaceUI();
  drawPhotoOverlay();
}

function finishSurfaceDrawing() {
  const photo = activePhoto();
  if (!photo || surfacePoints.length < 3) return;
  const surface = {
    id: String(Date.now()) + '-surface',
    name: 'Superfície ' + (photo.surfaces.length + 1),
    points: surfacePoints.map((point) => ({ ...point })),
    material: $('#surfaceMaterial').value,
    finish: $('#surfaceFinish').value,
    color: selectedSurfaceColor,
    colorName: selectedSurfaceName,
    opacity: surfaceOpacity,
    preserveOpenings: $('#preserveOpenings').checked
  };
  photo.surfaces.push(surface);
  selectedSurfaceId = surface.id;
  surfaceDrawing = false;
  surfacePoints = [];
  syncSurfaceUI();
  drawPhotoOverlay();
  notify('Contorno concluído. Escolha o material e a cor.');
}

function updateProgress(activeTab) {
  const saved = photos.filter((photo) => photo.saved).length;
  const areasUsed = new Set(photos.map((photo) => photo.area)).size;
  $('#photoStatus').textContent = photos.length ? photos.length + ' fotos · ' + areasUsed + ' áreas' : 'Adicionar fotografias';
  $('#scaleStatus').textContent = photos.length ? saved + ' de ' + photos.length + ' medidas salvas' : 'Aguardando fotos';
  const confirmed = objects.filter((object) => object.confirmed).length;
  $('#elementStatus').textContent = objects.length + ' elementos · ' + confirmed + ' conferidos';
  $('#presentationStatus').textContent = saved && objects.length ? 'Disponível para revisar' : 'Pendente';
  const progressButtons = [...document.querySelectorAll('#projectProgress button')];
  progressButtons[0].classList.toggle('complete', photos.length > 0);
  progressButtons[1].classList.toggle('complete', photos.length > 0 && saved === photos.length);
  progressButtons[2].classList.toggle('complete', objects.length > 0 && confirmed === objects.length);
  progressButtons[3].classList.toggle('complete', Boolean(saved && objects.length));
  if (activeTab) {
    progressButtons.forEach((button) => button.classList.remove('active'));
    const activeIndex = activeTab === 'survey' ? (photos.length ? 1 : 0) : activeTab === 'design' ? 2 : 3;
    progressButtons[activeIndex].classList.add('active');
  }
}

function updateForm() {
  const object = objects[selected];
  $('#objectTitle').textContent = object.name;
  $('#objectType').textContent = object.type;
  ['width', 'height', 'x', 'y', 'material', 'finish', 'label', 'color'].forEach((key) => {
    $('#' + key).value = object[key];
  });
  $('#confirmed').checked = object.confirmed;
  $('#selectionSummary').textContent = object.name;
  $('#measureSummary').textContent = object.width.toFixed(2) + ' × ' + object.height.toFixed(2) + ' m · ' + object.material;
  updateColor();
  $('#formMessage').textContent = '';
}

function updateColor() {
  const color = $('#color').value;
  $('#colorName').textContent = (colors.find((item) => item[1] === color) || ['Personalizada'])[0];
  document.querySelectorAll('[data-color]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.color === color);
  });
}

function projectBounds() {
  return {
    maxX: Math.max(...objects.map((object) => object.x + object.width)),
    maxY: Math.max(...objects.map((object) => object.y + object.height))
  };
}

function drawingMarkup(maxY) {
  let markup = '<line x1="-.6" y1="' + maxY + '" x2="' + (projectBounds().maxX + .6) + '" y2="' + maxY + '" stroke="#bec5c9" stroke-width=".025"/>';
  objects.forEach((object, index) => {
    const y = maxY - object.y - object.height;
    const selectedStroke = selected === index ? '#526c7d' : '#4e565c';
    markup += '<g data-object="' + index + '" tabindex="0" role="button" aria-label="' + escapeHtml(object.name) + '">';
    markup += '<rect x="' + object.x + '" y="' + y + '" width="' + object.width + '" height="' + object.height + '" fill="' + object.color + '" stroke="' + selectedStroke + '" stroke-width="' + (selected === index ? '.04' : '.015') + '"/>';
    if (object.label) {
      const labelColor = ['#eceeec', '#d7d9d9'].includes(object.color) ? '#303438' : 'white';
      const labelSize = Math.min(.45, object.width / Math.max(object.label.length, 1) * 1.3);
      markup += '<text x="' + (object.x + object.width / 2) + '" y="' + (y + Math.min(object.height * .6, .75)) + '" text-anchor="middle" fill="' + labelColor + '" font-family="Arial,sans-serif" font-size="' + labelSize + '" letter-spacing=".025">' + escapeHtml(object.label) + '</text>';
    }
    markup += '</g>';
    if (showDimensions && selected === index) {
      const dimensionY = y - .45;
      markup += '<g stroke="#71818c" stroke-width=".018" fill="none"><path d="M ' + object.x + ' ' + (y - .12) + ' V ' + (dimensionY - .15) + ' M ' + (object.x + object.width) + ' ' + (y - .12) + ' V ' + (dimensionY - .15) + ' M ' + object.x + ' ' + dimensionY + ' H ' + (object.x + object.width) + '"/><path d="M ' + (object.x - .12) + ' ' + y + ' H ' + (object.x - .5) + ' M ' + (object.x - .12) + ' ' + (y + object.height) + ' H ' + (object.x - .5) + ' M ' + (object.x - .38) + ' ' + y + ' V ' + (y + object.height) + '"/></g>';
      markup += '<g font-family="Arial" font-size=".2" fill="#617786"><text x="' + (object.x + object.width / 2) + '" y="' + (dimensionY - .12) + '" text-anchor="middle">' + object.width.toFixed(2) + ' m</text><text x="' + (object.x - .55) + '" y="' + (y + object.height / 2) + '" text-anchor="middle" transform="rotate(-90 ' + (object.x - .55) + ' ' + (y + object.height / 2) + ')">' + object.height.toFixed(2) + ' m</text></g>';
    }
  });
  return markup;
}

function draw() {
  const { maxX, maxY } = projectBounds();
  const padding = 2.1;
  const viewBox = [-padding, -padding, maxX + padding * 2, maxY + padding * 2];
  const centerX = viewBox[0] + viewBox[2] / 2;
  const centerY = viewBox[1] + viewBox[3] / 2;
  viewBox[2] *= 100 / zoom;
  viewBox[3] *= 100 / zoom;
  viewBox[0] = centerX - viewBox[2] / 2;
  viewBox[1] = centerY - viewBox[3] / 2;
  $('#drawing').setAttribute('viewBox', viewBox.join(' '));
  $('#drawing').innerHTML = drawingMarkup(maxY);
  $('#extent').textContent = 'Conjunto · ' + maxX.toFixed(2) + ' × ' + maxY.toFixed(2) + ' m';
  $('#stateNote').textContent = objects.filter((object) => object.confirmed).length + ' de ' + objects.length + ' elementos com medidas conferidas';
  $('#elements').innerHTML = objects.map((object, index) =>
    '<button class="element ' + (index === selected ? 'active' : '') + '" data-select="' + index + '"><span class="square"></span>' + object.name + '<span>' + String(index + 1).padStart(2, '0') + '</span></button>'
  ).join('');
  $('#presentationDrawing').innerHTML = '<svg viewBox="-2.1 -2.1 ' + (maxX + 4.2) + ' ' + (maxY + 4.2) + '" role="img" aria-label="Elevação do projeto">' + drawingMarkup(maxY) + '</svg>';
  drawPhotoOverlay();
  updateProgress();
}

function selectObject(index) {
  selected = index;
  updateForm();
  draw();
}

function createElement(copyFrom) {
  const source = copyFrom || objects[selected];
  const number = objects.length + 1;
  const object = {
    name: copyFrom ? source.name + ' · cópia' : 'Novo painel ' + number,
    type: copyFrom ? source.type : 'Revestimento',
    width: copyFrom ? source.width : 2.4,
    height: copyFrom ? source.height : .8,
    x: Math.max(0, source.x + .45),
    y: Math.max(0, source.y + .35),
    color: copyFrom ? source.color : '#737b80',
    material: copyFrom ? source.material : 'ACM',
    finish: copyFrom ? source.finish : 'Fosco',
    label: copyFrom ? source.label : '',
    confirmed: false
  };
  objects.push(object);
  selectObject(objects.length - 1);
  notify(copyFrom ? 'Elemento duplicado.' : 'Novo elemento adicionado ao projeto.');
}

function deleteSelectedElement() {
  if (objects.length === 1) {
    notify('O projeto precisa manter pelo menos um elemento.');
    return;
  }
  const removed = objects[selected].name;
  objects.splice(selected, 1);
  selected = Math.min(selected, objects.length - 1);
  updateForm();
  draw();
  notify(removed + ' foi excluído.');
}

function stageSize(stage) {
  return { width: Math.max(stage.clientWidth, 1), height: Math.max(stage.clientHeight, 1) };
}

function drawCalibration() {
  const photo = activePhoto();
  if (!photo) return;
  const stage = $('#calibrationStage');
  const overlay = $('#calibrationOverlay');
  const size = photo ? { width: photo.width || 1, height: photo.height || 1 } : stageSize(stage);
  overlay.setAttribute('viewBox', '0 0 ' + size.width + ' ' + size.height);
  let markup = '';
  if (photo.points[0]) {
    markup += '<circle class="calibration-mark" cx="' + photo.points[0].x + '" cy="' + photo.points[0].y + '" r="7" fill="#fff" stroke="#293238" stroke-width="3"/>';
  }
  if (photo.points[1]) {
    markup += '<line class="calibration-mark" x1="' + photo.points[0].x + '" y1="' + photo.points[0].y + '" x2="' + photo.points[1].x + '" y2="' + photo.points[1].y + '" stroke="#fff" stroke-width="4"/>';
    markup += '<line x1="' + photo.points[0].x + '" y1="' + photo.points[0].y + '" x2="' + photo.points[1].x + '" y2="' + photo.points[1].y + '" stroke="#293238" stroke-width="1.5"/>';
    markup += '<circle class="calibration-mark" cx="' + photo.points[1].x + '" cy="' + photo.points[1].y + '" r="7" fill="#fff" stroke="#293238" stroke-width="3"/>';
  }
  overlay.innerHTML = markup;
  $('#pointA').textContent = photo.points[0] ? 'Ponto A · marcado' : 'Ponto A · aguardando';
  $('#pointB').textContent = photo.points[1] ? 'Ponto B · marcado' : 'Ponto B · aguardando';
  $('#calibrate').disabled = photo.points.length < 2;
  if (!photo.saved) $('#stageHint').textContent = photo.points.length === 0 ? 'Clique no primeiro ponto da medida conhecida' : photo.points.length === 1 ? 'Clique no segundo ponto' : 'Informe a distância real e calibre';
}

function clearCalibration() {
  const photo = activePhoto();
  if (!photo) return;
  photo.points = [];
  photo.pixelsPerMeter = null;
  photo.origin = null;
  photo.saved = false;
  $('#calibrationResult').textContent = 'A escala ainda não foi definida.';
  $('#saveMeasurement').disabled = true;
  $('#usePhoto').disabled = true;
  drawCalibration();
  drawPhotoOverlay();
  renderPhotoLibrary();
}

function drawPhotoOverlay() {
  const photo = activePhoto();
  const stage = $('#compositionStage');
  const overlay = $('#compositionOverlay');
  const size = photo ? { width: photo.width || 1, height: photo.height || 1 } : stageSize(stage);
  overlay.setAttribute('viewBox', '0 0 ' + size.width + ' ' + size.height);
  $('#emptyPhoto').hidden = Boolean(photo);
  $('#compositionPhoto').hidden = !photo;
  if (!photo || !photo.pixelsPerMeter || !photo.origin) {
    overlay.innerHTML = '';
    return;
  }
  const { maxY } = projectBounds();
  const opacity = overlayOpacity / 100;
  let markup = '';
  (photo.surfaces || []).forEach((surface) => {
    const points = surface.points.map((point) => point.x + ',' + point.y).join(' ');
    const selectedStroke = surface.id === selectedSurfaceId ? '#ffffff' : 'rgba(255,255,255,.75)';
    markup += '<polygon data-surface-id="' + surface.id + '" points="' + points + '" fill="' + surface.color + '" fill-opacity="' + (surface.opacity / 100) + '" stroke="' + selectedStroke + '" stroke-width="' + (surface.id === selectedSurfaceId ? 3 : 1.5) + '"/>';
    if (surface.id === selectedSurfaceId) {
      surface.points.forEach((point) => {
        markup += '<circle cx="' + point.x + '" cy="' + point.y + '" r="5" fill="#fff" stroke="#30373c" stroke-width="2"/>';
      });
    }
  });
  if (surfaceDrawing && surfacePoints.length) {
    const draftPoints = surfacePoints.map((point) => point.x + ',' + point.y).join(' ');
    markup += '<polyline points="' + draftPoints + '" fill="' + (surfacePoints.length > 2 ? selectedSurfaceColor : 'none') + '" fill-opacity=".32" stroke="#ffffff" stroke-width="3" stroke-dasharray="8 5"/>';
    surfacePoints.forEach((point, index) => {
      markup += '<circle cx="' + point.x + '" cy="' + point.y + '" r="7" fill="#fff" stroke="#30373c" stroke-width="2"/><text x="' + point.x + '" y="' + (point.y - 12) + '" text-anchor="middle" fill="#fff" font-family="Arial" font-size="11">' + (index + 1) + '</text>';
    });
  }
  objects.forEach((object, index) => {
    const x = photo.origin.x + object.x * photo.pixelsPerMeter;
    const y = photo.origin.y - (object.y + object.height) * photo.pixelsPerMeter;
    const width = object.width * photo.pixelsPerMeter;
    const height = object.height * photo.pixelsPerMeter;
    const stroke = selected === index ? '#fff' : 'rgba(255,255,255,.7)';
    markup += '<g data-photo-object="' + index + '" opacity="' + opacity + '"><rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" rx="1" fill="' + object.color + '" stroke="' + stroke + '" stroke-width="' + (selected === index ? 3 : 1.2) + '"/>';
    if (object.label) {
      const labelColor = ['#eceeec', '#d7d9d9'].includes(object.color) ? '#303438' : '#fff';
      const labelSize = Math.max(9, Math.min(28, height * .42));
      markup += '<text x="' + (x + width / 2) + '" y="' + (y + Math.min(height * .62, 38)) + '" text-anchor="middle" fill="' + labelColor + '" font-family="Arial,sans-serif" font-size="' + labelSize + '">' + escapeHtml(object.label) + '</text>';
    }
    if (selected === index) {
      markup += '<circle cx="' + (x + width) + '" cy="' + (y + height) + '" r="5" fill="#fff" stroke="#354149" stroke-width="2"/>';
    }
    markup += '</g>';
  });
  overlay.innerHTML = markup;
}

function setView(view) {
  activeView = view;
  $('#elevationView').hidden = view !== 'elevation';
  $('#photoView').hidden = view !== 'photo';
  $('#opacityControl').hidden = view !== 'photo';
  $('.zoom').hidden = view !== 'elevation';
  $('#elementProperties').hidden = view === 'photo';
  $('#surfaceProperties').hidden = view !== 'photo';
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'photo') requestAnimationFrame(() => {
    syncSurfaceUI();
    drawPhotoOverlay();
  });
}

function setTab(tabName) {
  ['design', 'survey', 'presentation'].forEach((id) => $('#' + id).hidden = id !== tabName);
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tabName));
  $('#workEyebrow').textContent = { design: 'PROJETO VISUAL', survey: 'LEVANTAMENTO', presentation: 'APRESENTAÇÃO' }[tabName];
  $('#workTitle').textContent = { design: 'Identidade em escala.', survey: 'A base do projeto.', presentation: 'Pronto para visualizar.' }[tabName];
  $('.view-tools').hidden = tabName !== 'design';
  if (tabName !== 'design') {
    $('#elementProperties').hidden = false;
    $('#surfaceProperties').hidden = true;
  } else {
    $('#elementProperties').hidden = activeView === 'photo';
    $('#surfaceProperties').hidden = activeView !== 'photo';
  }
  updateProgress(tabName);
  if (tabName === 'presentation') { draw(); renderPresentation(); }
  if (tabName === 'survey' && activePhoto()) requestAnimationFrame(drawCalibration);
}

$('#elements').onclick = (event) => {
  const button = event.target.closest('[data-select]');
  if (button) selectObject(Number(button.dataset.select));
};

$('#drawing').onclick = (event) => {
  const object = event.target.closest('[data-object]');
  if (object) selectObject(Number(object.dataset.object));
};

$('#drawing').onkeydown = (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    const object = event.target.closest('[data-object]');
    if (object) {
      event.preventDefault();
      selectObject(Number(object.dataset.object));
    }
  }
};

$('#compositionOverlay').onpointerdown = (event) => {
  const photo = activePhoto();
  if (surfaceDrawing && photo) {
    const point = imagePoint(event, event.currentTarget, photo);
    if (!point) return;
    surfacePoints.push(point);
    syncSurfaceUI();
    drawPhotoOverlay();
    event.preventDefault();
    return;
  }
  const surface = event.target.closest('[data-surface-id]');
  if (surface) {
    selectedSurfaceId = surface.dataset.surfaceId;
    syncSurfaceUI();
    drawPhotoOverlay();
    event.preventDefault();
    return;
  }
  const group = event.target.closest('[data-photo-object]');
  if (!group || !photo || !photo.pixelsPerMeter) return;
  const index = Number(group.dataset.photoObject);
  selectObject(index);
  dragState = {
    index,
    startX: event.clientX,
    startY: event.clientY,
    objectX: objects[index].x,
    objectY: objects[index].y,
    imageScale: Math.min($('#compositionStage').clientWidth / photo.width, $('#compositionStage').clientHeight / photo.height)
  };
  $('#compositionOverlay').classList.add('dragging');
  event.preventDefault();
};

window.addEventListener('pointermove', (event) => {
  const photo = activePhoto();
  if (!dragState || !photo || !photo.pixelsPerMeter) return;
  const object = objects[dragState.index];
  object.x = Math.max(0, dragState.objectX + (event.clientX - dragState.startX) / (photo.pixelsPerMeter * dragState.imageScale));
  object.y = Math.max(0, dragState.objectY - (event.clientY - dragState.startY) / (photo.pixelsPerMeter * dragState.imageScale));
  $('#x').value = object.x.toFixed(2);
  $('#y').value = object.y.toFixed(2);
  $('#measureSummary').textContent = object.width.toFixed(2) + ' × ' + object.height.toFixed(2) + ' m · posição ' + object.x.toFixed(2) + ', ' + object.y.toFixed(2) + ' m';
  drawPhotoOverlay();
});

window.addEventListener('pointerup', () => {
  if (!dragState) return;
  dragState = null;
  $('#compositionOverlay').classList.remove('dragging');
  draw();
  $('#formMessage').textContent = 'Posição atualizada diretamente sobre a fotografia.';
});

$('#properties').onsubmit = (event) => {
  event.preventDefault();
  const object = objects[selected];
  ['width', 'height', 'x', 'y'].forEach((key) => object[key] = Number($('#' + key).value));
  ['material', 'finish', 'label', 'color'].forEach((key) => object[key] = $('#' + key).value);
  object.confirmed = $('#confirmed').checked;
  draw();
  updateForm();
  $('#formMessage').textContent = 'Dimensões e propriedades aplicadas ao estudo.';
};

$('#addElement').onclick = () => createElement();
$('#duplicateElement').onclick = () => createElement(objects[selected]);
$('#deleteElement').onclick = deleteSelectedElement;

$('#swatches').innerHTML = colors.map(([name, color]) =>
  '<button type="button" data-color="' + color + '" style="background:' + color + '" aria-label="' + name + '" title="' + name + '"></button>'
).join('');
$('#swatches').onclick = (event) => {
  if (event.target.dataset.color) {
    $('#color').value = event.target.dataset.color;
    updateColor();
  }
};
$('#color').oninput = updateColor;

document.querySelectorAll('[data-tab]').forEach((button) => button.onclick = () => setTab(button.dataset.tab));
document.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => setView(button.dataset.view));
document.querySelectorAll('[data-go]').forEach((button) => button.onclick = () => setTab(button.dataset.go));

$('#dimensions').onclick = () => {
  showDimensions = !showDimensions;
  $('#dimensions').textContent = showDimensions ? 'Cotas visíveis' : 'Mostrar cotas';
  $('#dimensions').setAttribute('aria-pressed', showDimensions);
  draw();
};

$('#zoom').oninput = (event) => {
  zoom = Number(event.target.value);
  $('#zoomValue').value = zoom + '%';
  draw();
};

$('#overlayOpacity').oninput = (event) => {
  overlayOpacity = Number(event.target.value);
  $('#opacityValue').value = overlayOpacity + '%';
  drawPhotoOverlay();
};

$('#markSurface').onclick = beginSurfaceDrawing;
$('#newSurface').onclick = beginSurfaceDrawing;
$('#finishSurface').onclick = finishSurfaceDrawing;
$('#undoSurface').onclick = () => {
  if (!surfaceDrawing || !surfacePoints.length) return;
  surfacePoints.pop();
  syncSurfaceUI();
  drawPhotoOverlay();
};
$('#clearSurface').onclick = () => {
  const photo = activePhoto();
  if (surfaceDrawing) {
    surfacePoints = [];
    surfaceDrawing = false;
  } else if (photo && selectedSurfaceId) {
    photo.surfaces = photo.surfaces.filter((surface) => surface.id !== selectedSurfaceId);
    selectedSurfaceId = photo.surfaces[0]?.id || null;
  }
  syncSurfaceUI();
  drawPhotoOverlay();
};

$('#catalogColors').onclick = (event) => {
  const button = event.target.closest('[data-catalog-color]');
  if (!button) return;
  selectedSurfaceColor = button.dataset.catalogColor;
  selectedSurfaceName = button.dataset.catalogName;
  const surface = activeSurface();
  if (surface) {
    surface.color = selectedSurfaceColor;
    surface.colorName = selectedSurfaceName;
  }
  renderCatalog();
  drawPhotoOverlay();
};

$('#surfaceOpacity').oninput = (event) => {
  surfaceOpacity = Number(event.target.value);
  $('#surfaceOpacityValue').value = surfaceOpacity + '%';
  const surface = activeSurface();
  if (surface) surface.opacity = surfaceOpacity;
  drawPhotoOverlay();
};

document.querySelectorAll('[data-light]').forEach((button) => button.onclick = () => {
  lightMode = button.dataset.light;
  document.querySelectorAll('[data-light]').forEach((item) => item.classList.toggle('active', item === button));
  $('#compositionStage').classList.toggle('night-mode', lightMode === 'night');
});

$('#applySurface').onclick = () => {
  const surface = activeSurface();
  if (!surface) return;
  surface.material = $('#surfaceMaterial').value;
  surface.finish = $('#surfaceFinish').value;
  surface.color = selectedSurfaceColor;
  surface.colorName = selectedSurfaceName;
  surface.opacity = surfaceOpacity;
  surface.preserveOpenings = $('#preserveOpenings').checked;
  $('#surfaceMessage').textContent = 'Acabamento aplicado na simulação visual.';
  drawPhotoOverlay();
  notify('Acabamento aplicado à área marcada.');
};

$('#resetView').onclick = () => {
  zoom = 100;
  $('#zoom').value = 100;
  $('#zoomValue').value = '100%';
  draw();
};

$('#present').onclick = () => {
  document.body.classList.toggle('presenting');
  $('#present').textContent = document.body.classList.contains('presenting') ? 'Voltar ao projeto' : 'Apresentar projeto ↗';
  setTab(document.body.classList.contains('presenting') ? 'presentation' : 'design');
};

['uploadMain', 'uploadEmpty', 'uploadSide'].forEach((id) => $('#' + id).onclick = () => $('#photoInput').click());
$('#addPhotoFromDesign').onclick = () => setTab('survey');

$('#photoInput').onchange = async (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  const valid = files.filter((file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 15 * 1024 * 1024);
  if (!valid.length) {
    notify('Selecione JPG, PNG ou WebP com até 15 MB por imagem.');
    return;
  }
  const area = $('#uploadArea').value;
  const added = valid.map((file) => ({
    id: String(Date.now()) + '-' + Math.random().toString(36).slice(2),
    name: file.name,
    area,
    url: URL.createObjectURL(file),
    points: [],
    referenceDistance: 12.4,
    pixelsPerMeter: null,
    origin: null,
    saved: false,
    surfaces: []
  }));
  const loaded = await Promise.all(added.map(photo => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { photo.width = img.naturalWidth; photo.height = img.naturalHeight; resolve(photo); };
    img.onerror = () => { URL.revokeObjectURL(photo.url); resolve(null); };
    img.src = photo.url;
  })));
  const ready = loaded.filter(Boolean);
  if (!ready.length) { notify('Não foi possível abrir as imagens. Tente outro arquivo.'); return; }
  photos.push(...ready);
  event.target.value = '';
  setTab('survey');
  loadActivePhoto(ready[0].id);
  notify(ready.length + (ready.length === 1 ? ' foto adicionada.' : ' fotos adicionadas.') + ' Agora calibre a medida.');
};

$('#calibrationStage').onclick = (event) => {
  const photo = activePhoto();
  if (!photo || photo.points.length >= 2) return;
  const point = imagePoint(event, event.currentTarget, photo);
  if (!point) return;
  photo.points.push(point);
  photo.saved = false;
  drawCalibration();
};

$('#clearCalibration').onclick = clearCalibration;

$('#calibrate').onclick = () => {
  const photo = activePhoto();
  const distance = Number($('#referenceDistance').value);
  if (!photo || !distance || distance <= 0 || photo.points.length < 2) {
    notify('Informe uma distância real válida.');
    return;
  }
  const dx = photo.points[1].x - photo.points[0].x;
  const dy = photo.points[1].y - photo.points[0].y;
  const pixelDistance = Math.hypot(dx, dy);
  if (pixelDistance < 2 || !Number.isFinite(distance)) { notify('Marque dois pontos diferentes e informe uma distância válida.'); return; }
  photo.referenceDistance = distance;
  photo.pixelsPerMeter = pixelDistance / distance;
  photo.origin = {
    x: Math.min(photo.points[0].x, photo.points[1].x),
    y: Math.max(photo.points[0].y, photo.points[1].y)
  };
  photo.saved = false;
  $('#calibrationResult').innerHTML = '<b>Escala calculada</b><br>' + photo.pixelsPerMeter.toFixed(1) + ' pixels por metro · referência de ' + distance.toFixed(2) + ' m';
  $('#saveMeasurement').disabled = false;
  $('#usePhoto').disabled = true;
  $('#stageHint').textContent = 'Confira e salve a medida desta foto';
  drawPhotoOverlay();
  updateProgress('survey');
  renderPhotoLibrary();
};

$('#saveMeasurement').onclick = () => {
  const photo = activePhoto();
  if (!photo || !photo.pixelsPerMeter) return;
  photo.saved = true;
  $('#calibrationResult').innerHTML = '<b>Medida salva</b><br>' + photo.referenceDistance.toFixed(2) + ' m · ' + photo.pixelsPerMeter.toFixed(1) + ' pixels por metro';
  $('#saveMeasurement').disabled = true;
  $('#usePhoto').disabled = false;
  $('#stageHint').textContent = 'Medida salva para esta fotografia';
  renderPhotoLibrary();
  notify('Escala salva para ' + photo.name + '.');
};

$('#usePhoto').onclick = () => {
  setTab('design');
  setView('photo');
  notify('Projeto proporcional aplicado sobre a fotografia.');
};

$('#photoAreas').onclick = (event) => {
  const photoButton = event.target.closest('[data-photo-id]');
  if (photoButton) {
    loadActivePhoto(photoButton.dataset.photoId);
    return;
  }
  const areaButton = event.target.closest('[data-add-to-area]');
  if (areaButton) {
    $('#uploadArea').value = areaButton.dataset.addToArea;
    $('#photoInput').click();
  }
};

$('#addArea').onclick = () => {
  const name = window.prompt('Nome da nova área do levantamento:');
  if (!name || !name.trim()) return;
  const cleanName = name.trim();
  if (areaNames.some((area) => area.toLowerCase() === cleanName.toLowerCase())) {
    notify('Essa área já existe no levantamento.');
    return;
  }
  areaNames.push(cleanName);
  renderPhotoLibrary();
  $('#uploadArea').value = cleanName;
  notify('Área adicionada. Agora você pode incluir as fotos.');
};

$('#newProject').onclick = () => openProjectDialog(true);
$('#editProject').onclick = () => openProjectDialog(false);
$('#closeProject').onclick = () => $('#projectDialog').close();
$('#cancelProject').onclick = () => $('#projectDialog').close();
$('#projectName').onchange = (event) => {
  projectData.name = event.target.value.trim() || projectData.name;
  syncProjectUI();
};

$('#projectForm').onsubmit = (event) => {
  event.preventDefault();
  const isNew = $('#projectDialog').dataset.mode === 'new';
  if (isNew && photos.length && !window.confirm('Iniciar um novo projeto e limpar as fotografias atuais?')) return;
  if (isNew) {
    photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    photos = [];
    activePhotoId = null;
    areaNames = ['Fachada principal', 'Lateral', 'Totem e acesso'];
    $('#calibration').hidden = true;
    $('#surveyPhoto').removeAttribute('src');
    $('#compositionPhoto').removeAttribute('src');
    objects.forEach((object) => object.confirmed = false);
  }
  projectData = {
    name: $('#dialogProjectName').value.trim(),
    client: $('#clientName').value.trim(),
    location: $('#siteLocation').value.trim()
  };
  syncProjectUI();
  renderPhotoLibrary();
  draw();
  $('#projectDialog').close();
  setTab('survey');
  notify(isNew ? 'Novo projeto criado. Comece adicionando as fotos.' : 'Dados do projeto atualizados.');
};

function download(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#download').onclick = () => download(JSON.stringify({
  project: projectData,
  units: 'm',
  kind: 'estudo-visual',
  photos: photos.map(({ name, area, referenceDistance, pixelsPerMeter, saved, surfaces = [] }) => ({
    name,
    area,
    referenceDistance,
    pixelsPerMeter,
    saved,
    surfaces: surfaces.map(({ name: surfaceName, material, finish, colorName, opacity, preserveOpenings, points }) => ({
      name: surfaceName,
      material,
      finish,
      colorName,
      opacity,
      preserveOpenings,
      points
    }))
  })),
  objects
}, null, 2), 'application/json', 'artelux-estudo.json');

$('#exportSvg').onclick = () => download(
  $('#drawing').outerHTML.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '),
  'image/svg+xml',
  'artelux-elevacao.svg'
);

$('#print').onclick = () => { renderPresentation(); window.print(); };
window.addEventListener('resize', () => {
  if (activePhoto()) {
    drawCalibration();
    drawPhotoOverlay();
  }
});

/**
 * Converte o clique do usuario em pixels da foto original.
 *
 * A caixa de referencia precisa ser a MESMA em que o overlay desenha: o SVG usa
 * viewBox = dimensoes da foto e preserveAspectRatio padrao, ou seja, encaixa a
 * foto centralizada dentro da propria caixa. Medir outra caixa (o palco, quando
 * o CSS encolhe a <img>) devolve um pixel diferente do que o usuario viu — era
 * a origem do erro de 23% na escala de calibracao.
 */
function imagePoint(event, elemento, photo) {
  if (!photo.width || !photo.height) return null;
  const stage = elemento.closest('.photo-stage') || elemento;
  const overlay = elemento.tagName === 'svg' ? elemento : stage.querySelector('svg');
  const rect = (overlay || elemento).getBoundingClientRect();
  const img = stage.querySelector('img');
  if (img) {
    const caixaFoto = img.getBoundingClientRect();
    if (Math.abs(caixaFoto.width - rect.width) > 1 || Math.abs(caixaFoto.height - rect.height) > 1) {
      console.warn('Calibracao: a foto (' + Math.round(caixaFoto.width) + 'x' + Math.round(caixaFoto.height) + ') e a camada de marcacao (' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ') tem tamanhos diferentes. A medida sairia errada — confira o CSS do palco.');
    }
  }
  const scale = Math.min(rect.width / photo.width, rect.height / photo.height);
  const x = (event.clientX - rect.left - (rect.width - photo.width * scale) / 2) / scale;
  const y = (event.clientY - rect.top - (rect.height - photo.height * scale) / 2) / scale;
  return x >= 0 && y >= 0 && x <= photo.width && y <= photo.height ? {x, y} : null;
}

function presentationPhoto(photo, proposed) {
  const w = photo.width, h = photo.height;
  let markup = '<image href="' + escapeHtml(photo.url) + '" width="' + w + '" height="' + h + '"' + (proposed && lightMode === 'night' ? ' style="filter:brightness(.36) saturate(.76)"' : '') + '/>';
  if (proposed && photo.saved) {
    markup += (photo.surfaces || []).map(surface => '<polygon points="' + surface.points.map(p => p.x + ',' + p.y).join(' ') + '" fill="' + surface.color + '" fill-opacity="' + surface.opacity / 100 + '"/>').join('');
    objects.forEach(object => {
      const x = photo.origin.x + object.x * photo.pixelsPerMeter;
      const y = photo.origin.y - (object.y + object.height) * photo.pixelsPerMeter;
      const width = object.width * photo.pixelsPerMeter, height = object.height * photo.pixelsPerMeter;
      markup += '<g opacity="' + overlayOpacity / 100 + '"><rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" fill="' + object.color + '"/>';
      if (object.label) markup += '<text x="' + (x + width / 2) + '" y="' + (y + height * .6) + '" text-anchor="middle" fill="white" font-family="Arial" font-size="' + Math.min(height * .42, width / Math.max(object.label.length, 1) * 1.3) + '">' + escapeHtml(object.label) + '</text>';
      markup += '</g>';
    });
  }
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + (proposed ? 'Simulação visual' : 'Foto original') + '">' + markup + '</svg>';
}

function renderPresentation() {
  $('#presentationName').textContent = projectData.name;
  $('#presentationClient').textContent = projectData.client + (projectData.location ? ' · ' + projectData.location : ' · Local não informado');
  $('#presentationPhotos').innerHTML = photos.length ? photos.map(photo => '<article class="presentation-photo"><div class="presentation-photo-head"><h3>' + escapeHtml(photo.area) + '</h3><span>' + escapeHtml(photo.name) + ' · ' + (photo.saved ? 'Referência: ' + photo.referenceDistance.toFixed(2) + ' m' : 'Escala pendente') + '</span></div><div class="comparison"><figure><figcaption>Foto original</figcaption>' + presentationPhoto(photo, false) + '</figure><figure><figcaption>Simulação · ' + (lightMode === 'night' ? 'Noite' : 'Dia') + '</figcaption>' + (photo.saved ? presentationPhoto(photo, true) : '<p class="presentation-empty">Calibre e salve a medida desta foto para visualizar a proposta.</p>') + '</figure></div></article>').join('') : '<div class="presentation-empty">Adicione uma fotografia no levantamento para comparar o antes e depois. A elevação abaixo mostra os elementos do estudo.</div>';
  $('#presentationMaterials').innerHTML = objects.map(o => '<tr><td>' + escapeHtml(o.name) + '</td><td>' + escapeHtml(o.material + ' · ' + o.finish) + '</td><td><span class="material-dot" style="background:' + o.color + '"></span>' + escapeHtml((colors.find(c => c[1] === o.color) || [o.color])[0]) + '</td><td>' + o.width.toFixed(2) + ' × ' + o.height.toFixed(2) + ' m</td><td>' + (o.confirmed ? 'Conferida' : 'A conferir') + '</td></tr>').join('') + photos.flatMap(photo => (photo.surfaces || []).map(surface => '<tr><td>' + escapeHtml(photo.area + ' · ' + surface.name) + '</td><td>' + escapeHtml(surface.material + ' · ' + surface.finish) + '</td><td><span class="material-dot" style="background:' + surface.color + '"></span>' + escapeHtml(surface.colorName) + '</td><td>Contorno na fotografia</td><td>Estudo visual</td></tr>')).join('');
}

updateForm();
syncProjectUI();
renderPhotoLibrary();
renderCatalog();
syncSurfaceUI();
draw();
updateProgress('survey');
