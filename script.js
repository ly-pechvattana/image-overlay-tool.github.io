const $ = id => document.getElementById(id);
const log = msg => $('log').textContent = msg;

const EXPAND_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M5.828 10.172a.5.5 0 0 0-.707 0l-4.096 4.096V11.5a.5.5 0 0 0-1 0v3.975a.5.5 0 0 0 .5.5H4.5a.5.5 0 0 0 0-1H1.732l4.096-4.096a.5.5 0 0 0 0-.707m4.344-4.344a.5.5 0 0 0 .707 0l4.096-4.096V4.5a.5.5 0 1 0 1 0V.525a.5.5 0 0 0-.5-.5H11.5a.5.5 0 0 0 0 1h2.768l-4.096 4.096a.5.5 0 0 0 0 .707"/></svg>';

let processedFiles = [];
let zipUrl = null;
let lightboxActive = false;
let selectedPhotos = [];

const cropState = {
  active: false,
  ratio: null,
  currentIndex: 0,
  currentPhoto: null,
  currentImage: null,
  currentDisplayRect: null,
  selection: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  dragging: false
};

function isHeicFile(file){
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return type === 'image/heic' ||
    type === 'image/heif' ||
    type === 'image/heic-sequence' ||
    type === 'image/heif-sequence' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif');
}

function parseRatio(value){
  if (!value || value === 'none') return null;
  const parts = value.split(':').map(Number);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return parts[0] / parts[1];
}

function getSourceName(source, fallbackName){
  return source && source.name ? source.name : fallbackName || 'image';
}

function updatePhotoStatus(){
  if (!selectedPhotos.length) {
    $('photoStatus').textContent = 'No photos selected yet.';
    $('cropPhotos').disabled = true;
    return;
  }

  const croppedCount = selectedPhotos.filter(photo => photo.cropped).length;
  const ratio = $('cropRatio').value;
  const statusParts = [`${selectedPhotos.length} photo(s) selected.`];
  if (croppedCount) {
    statusParts.push(`${croppedCount} cropped${ratio !== 'none' ? ` to ${ratio}` : ''}.`);
  } else if (ratio !== 'none') {
    statusParts.push(`Ready to crop to ${ratio}.`);
  }

  $('photoStatus').textContent = statusParts.join(' ');
  $('cropPhotos').disabled = ratio === 'none';
}

function setSelectedPhotos(files){
  selectedPhotos = files.map(file => ({
    name: file.name,
    source: file,
    cropped: false
  }));
  updatePhotoStatus();
}

function decodeImageFromDataUrl(dataUrl, fileName){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error(`${fileName} has invalid image dimensions.`));
        return;
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error(
      `Could not decode ${fileName}. This browser may not support this image format.`
    ));
    img.src = dataUrl;
  });
}

async function convertHeicToDataUrl(file, fileName){
  if (!window.heic2any) {
    throw new Error('HEIC support failed to load. Reload the page with internet access and try again.');
  }

  const converted = await window.heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.92
  });

  const outputBlob = Array.isArray(converted) ? converted[0] : converted;
  if (!(outputBlob instanceof Blob)) {
    throw new Error(`Could not convert ${fileName} from HEIC.`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read converted ${fileName}.`));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(outputBlob);
  });
}

async function loadImageSource(source, fallbackName){
  const fileName = getSourceName(source, fallbackName);

  try {
    if (isHeicFile(source)) {
      const dataUrl = await convertHeicToDataUrl(source, fileName);
      return await decodeImageFromDataUrl(dataUrl, fileName);
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Could not read ${fileName}.`));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(source);
    });

    return await decodeImageFromDataUrl(dataUrl, fileName);
  } catch (error) {
    if (isHeicFile(source)) {
      throw new Error(
        `Could not decode ${fileName}. HEIC/HEIF conversion failed in this browser. ` +
        `Try Chrome, Edge, or convert the photo to JPEG first.`
      );
    }
    throw error;
  }
}

async function loadImage(file){
  return loadImageSource(file, file.name);
}

function canvasToBlob(canvas, type){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create output image.')), type, 0.92);
  });
}

function safeName(name, index, ext){
  const base = name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_').slice(0,80) || ('image_'+index);
  return base + '_footer.' + ext;
}

function clearPreviousResults(){
  processedFiles.forEach(file => URL.revokeObjectURL(file.url));
  processedFiles = [];
  $('results').innerHTML = '';
  closeLightbox();

  if (zipUrl) {
    URL.revokeObjectURL(zipUrl);
    zipUrl = null;
  }

  $('downloadZip').style.display = 'none';
  $('downloadAll').style.display = 'none';
  $('downloadNote').style.display = 'none';
}

function showIndividualDownloads(){
  const results = $('results');
  results.innerHTML = '';

  processedFiles.forEach(file => {
    const item = document.createElement('div');
    item.className = 'result';

    const previewWrap = document.createElement('div');
    previewWrap.className = 'preview-wrap';

    const preview = document.createElement('img');
    preview.src = file.url;
    preview.alt = file.name;

    const expandButton = document.createElement('button');
    expandButton.type = 'button';
    expandButton.className = 'expand-btn';
    expandButton.title = 'View larger image';
    expandButton.setAttribute('aria-label', `View ${file.name} larger`);
    expandButton.innerHTML = EXPAND_ICON;
    expandButton.onclick = () => openLightbox(file);

    const name = document.createElement('div');
    name.className = 'result-name';
    name.title = file.name;
    name.textContent = file.name;

    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.name;
    link.textContent = 'Download image';

    previewWrap.append(preview, expandButton);
    item.append(previewWrap, name, link);
    results.appendChild(item);
  });
}

function openLightbox(file){
  $('lightboxImage').src = file.url;
  $('lightboxImage').alt = file.name;
  $('lightboxCaption').textContent = file.name;
  $('lightbox').classList.add('open');
  $('lightbox').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  lightboxActive = true;
}

function closeLightbox(){
  $('lightbox').classList.remove('open');
  $('lightbox').setAttribute('aria-hidden', 'true');
  $('lightboxImage').removeAttribute('src');
  $('lightboxImage').alt = '';
  $('lightboxCaption').textContent = '';
  if (!cropState.active) {
    document.body.style.overflow = '';
  }
  lightboxActive = false;
}

function clamp(value, min, max){
  return Math.min(Math.max(value, min), max);
}

function positionCropSelection(){
  const selection = cropState.selection;
  if (!selection) return;

  $('cropSelection').style.left = `${selection.x}px`;
  $('cropSelection').style.top = `${selection.y}px`;
  $('cropSelection').style.width = `${selection.width}px`;
  $('cropSelection').style.height = `${selection.height}px`;
}

function buildInitialSelection(displayWidth, displayHeight, ratio){
  let width = displayWidth;
  let height = width / ratio;

  if (height > displayHeight) {
    height = displayHeight;
    width = height * ratio;
  }

  return {
    x: Math.round((displayWidth - width) / 2),
    y: Math.round((displayHeight - height) / 2),
    width: Math.round(width),
    height: Math.round(height)
  };
}

async function prepareCropStep(){
  const photo = selectedPhotos[cropState.currentIndex];
  cropState.currentPhoto = photo;

  $('cropStep').textContent = `Photo ${cropState.currentIndex + 1} of ${selectedPhotos.length}`;
  $('cropRatioLabel').textContent = `Ratio: ${$('cropRatio').value}`;
  $('cropImageName').textContent = photo.name;

  const image = await loadImageSource(photo.source, photo.name);
  cropState.currentImage = image;

  const cropImage = $('cropImage');
  cropImage.src = image.src;
  cropImage.alt = photo.name;

  await new Promise(resolve => {
    if (cropImage.complete) {
      requestAnimationFrame(resolve);
      return;
    }
    cropImage.onload = () => requestAnimationFrame(resolve);
  });

  const displayWidth = cropImage.clientWidth;
  const displayHeight = cropImage.clientHeight;
  cropState.currentDisplayRect = { width: displayWidth, height: displayHeight };
  cropState.selection = buildInitialSelection(displayWidth, displayHeight, cropState.ratio);
  positionCropSelection();
}

async function openCropModal(){
  if (!selectedPhotos.length) {
    log('Choose photos first.');
    return;
  }

  const ratioValue = $('cropRatio').value;
  const ratio = parseRatio(ratioValue);
  if (!ratio) {
    log('Choose a crop ratio first.');
    return;
  }

  cropState.active = true;
  cropState.ratio = ratio;
  cropState.currentIndex = 0;
  document.body.style.overflow = 'hidden';
  $('cropModal').classList.add('open');
  $('cropModal').setAttribute('aria-hidden', 'false');
  log(`Crop mode ready. Ratio locked to ${ratioValue}.`);

  try {
    await prepareCropStep();
  } catch (error) {
    closeCropModal();
    const message = error instanceof Error ? error.message : String(error);
    log('Error: ' + message);
  }
}

function closeCropModal(){
  $('cropModal').classList.remove('open');
  $('cropModal').setAttribute('aria-hidden', 'true');
  $('cropImage').removeAttribute('src');
  $('cropImage').alt = '';
  cropState.active = false;
  cropState.currentPhoto = null;
  cropState.currentImage = null;
  cropState.currentDisplayRect = null;
  cropState.selection = null;
  cropState.dragging = false;
  document.body.style.overflow = lightboxActive ? 'hidden' : '';
}

async function goToNextCropStep(){
  if (cropState.currentIndex >= selectedPhotos.length - 1) {
    closeCropModal();
    updatePhotoStatus();
    log(`Crop step finished. ${selectedPhotos.filter(photo => photo.cropped).length} photo(s) updated.`);
    return;
  }

  cropState.currentIndex += 1;
  await prepareCropStep();
}

async function applyCurrentCrop(){
  const selection = cropState.selection;
  const image = cropState.currentImage;
  const photo = cropState.currentPhoto;
  const display = cropState.currentDisplayRect;
  if (!selection || !image || !photo || !display) return;

  const scaleX = image.naturalWidth / display.width;
  const scaleY = image.naturalHeight / display.height;
  const cropX = Math.round(selection.x * scaleX);
  const cropY = Math.round(selection.y * scaleY);
  const cropWidth = Math.round(selection.width * scaleX);
  const cropHeight = Math.round(selection.height * scaleY);

  const canvas = document.createElement('canvas');
  canvas.width = cropWidth;
  canvas.height = cropHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas is not supported by this browser.');
  }

  ctx.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  const outputType = photo.source.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await canvasToBlob(canvas, outputType);
  const croppedFile = new File([blob], photo.name, { type: outputType });

  selectedPhotos[cropState.currentIndex] = {
    ...photo,
    source: croppedFile,
    cropped: true
  };

  await goToNextCropStep();
}

function startCropDrag(clientX, clientY){
  if (!cropState.selection) return;

  const viewportRect = $('cropViewport').getBoundingClientRect();
  cropState.dragging = true;
  cropState.dragOffsetX = clientX - viewportRect.left - cropState.selection.x;
  cropState.dragOffsetY = clientY - viewportRect.top - cropState.selection.y;
}

function moveCropSelection(clientX, clientY){
  if (!cropState.dragging || !cropState.selection || !cropState.currentDisplayRect) return;

  const viewportRect = $('cropViewport').getBoundingClientRect();
  const maxX = cropState.currentDisplayRect.width - cropState.selection.width;
  const maxY = cropState.currentDisplayRect.height - cropState.selection.height;
  cropState.selection.x = clamp(clientX - viewportRect.left - cropState.dragOffsetX, 0, maxX);
  cropState.selection.y = clamp(clientY - viewportRect.top - cropState.dragOffsetY, 0, maxY);
  positionCropSelection();
}

function stopCropDrag(){
  cropState.dragging = false;
}

$('photos').addEventListener('change', event => {
  setSelectedPhotos([...event.target.files]);
});

$('cropRatio').addEventListener('change', updatePhotoStatus);
$('cropPhotos').onclick = openCropModal;
$('cropClose').onclick = closeCropModal;
$('cropSkip').onclick = goToNextCropStep;
$('cropApply').onclick = async () => {
  try {
    await applyCurrentCrop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('Error: ' + message);
  }
};

$('cropSelection').addEventListener('pointerdown', event => {
  event.preventDefault();
  startCropDrag(event.clientX, event.clientY);
});

$('cropViewport').addEventListener('pointermove', event => {
  moveCropSelection(event.clientX, event.clientY);
});

$('cropViewport').addEventListener('pointerup', stopCropDrag);
$('cropViewport').addEventListener('pointerleave', stopCropDrag);
document.addEventListener('pointermove', event => {
  moveCropSelection(event.clientX, event.clientY);
});
document.addEventListener('pointerup', stopCropDrag);

$('lightboxClose').onclick = closeLightbox;
$('lightbox').onclick = event => {
  if (event.target === $('lightbox')) {
    closeLightbox();
  }
};

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && cropState.active) {
    closeCropModal();
    return;
  }

  if (event.key === 'Escape' && lightboxActive) {
    closeLightbox();
  }
});

$('downloadAll').onclick = async () => {
  if (!processedFiles.length) return;

  log(`Starting ${processedFiles.length} image downloads...`);
  for (let i = 0; i < processedFiles.length; i++) {
    const file = processedFiles[i];
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  log('Download requests sent. Check your Downloads folder.');
};

$('process').onclick = async () => {
  const photos = selectedPhotos.map(photo => photo.source);
  const footerFile = $('footer').files[0];
  const type = $('format').value;
  const ext = type === 'image/png' ? 'png' : 'jpg';

  if (!photos.length) return log('Choose photos first.');
  if (!footerFile) return log('Choose footer image first.');
  if (!window.JSZip) return log('ZIP library not loaded. Turn internet on once, reload this file, then try again.');

  $('process').disabled = true;
  clearPreviousResults();

  try {
    const footer = await loadImage(footerFile);
    const zip = new JSZip();

    for (let i=0; i<photos.length; i++) {
      const photoName = getSourceName(photos[i], `image_${i + 1}`);
      log(`Processing ${i+1}/${photos.length}: ${photoName}`);
      const photo = await loadImageSource(photos[i], photoName);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not supported by this browser.');
      canvas.width = photo.naturalWidth;
      canvas.height = photo.naturalHeight;

      ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);

      const footerW = canvas.width;
      const footerH = Math.round(footer.naturalHeight * (footerW / footer.naturalWidth));
      if (!Number.isFinite(footerH) || footerH <= 0) {
        throw new Error('The footer image has invalid dimensions.');
      }
      const y = Math.max(0, canvas.height - footerH);
      const drawH = Math.min(footerH, canvas.height);
      ctx.drawImage(footer, 0, 0, footer.naturalWidth, footer.naturalHeight, 0, y, footerW, drawH);

      const blob = await canvasToBlob(canvas, type);
      const name = safeName(photoName, i+1, ext);
      const url = URL.createObjectURL(blob);

      processedFiles.push({name, blob, url});
      zip.file(name, blob);
    }

    showIndividualDownloads();

    log('Creating ZIP...');
    const zipBlob = await zip.generateAsync({type:'blob'});
    zipUrl = URL.createObjectURL(zipBlob);
    $('downloadZip').href = zipUrl;
    $('downloadZip').download = 'images_with_footer.zip';
    $('downloadZip').style.display = 'block';
    $('downloadAll').style.display = 'block';
    $('downloadNote').style.display = 'block';
    log(`Done. ${processedFiles.length} image(s) are ready. Choose ZIP, separate downloads, or an individual image below.`);
  } catch (e) {
    clearPreviousResults();
    const message = e instanceof Error ? e.message : String(e);
    log('Error: ' + message);
    console.error(e);
  } finally {
    $('process').disabled = false;
  }
};

updatePhotoStatus();
