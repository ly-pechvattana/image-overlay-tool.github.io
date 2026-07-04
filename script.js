const $ = id => document.getElementById(id);
const log = msg => $('log').textContent = msg;
let processedFiles = [];
let zipUrl = null;
let lightboxActive = false;

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

async function convertHeicToDataUrl(file){
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
    throw new Error(`Could not convert ${file.name} from HEIC.`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read converted ${file.name}.`));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(outputBlob);
  });
}

async function loadImage(file){
  try {
    if (isHeicFile(file)) {
      const dataUrl = await convertHeicToDataUrl(file);
      return await decodeImageFromDataUrl(dataUrl, file.name);
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });

    return await decodeImageFromDataUrl(dataUrl, file.name);
  } catch (error) {
    if (isHeicFile(file)) {
      throw new Error(
        `Could not decode ${file.name}. HEIC/HEIF conversion failed in this browser. ` +
        `Try Chrome, Edge, or convert the photo to JPEG first.`
      );
    }
    throw error;
  }
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
    expandButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M5.828 10.172a.5.5 0 0 0-.707 0l-4.096 4.096V11.5a.5.5 0 0 0-1 0v3.975a.5.5 0 0 0 .5.5H4.5a.5.5 0 0 0 0-1H1.732l4.096-4.096a.5.5 0 0 0 0-.707m4.344-4.344a.5.5 0 0 0 .707 0l4.096-4.096V4.5a.5.5 0 1 0 1 0V.525a.5.5 0 0 0-.5-.5H11.5a.5.5 0 0 0 0 1h2.768l-4.096 4.096a.5.5 0 0 0 0 .707"/></svg>';
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
  document.body.style.overflow = '';
  lightboxActive = false;
}

$('lightboxClose').onclick = closeLightbox;
$('lightbox').onclick = event => {
  if (event.target === $('lightbox')) {
    closeLightbox();
  }
};

document.addEventListener('keydown', event => {
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
  const photos = [...$('photos').files];
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
      log(`Processing ${i+1}/${photos.length}: ${photos[i].name}`);
      const photo = await loadImage(photos[i]);

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
      const name = safeName(photos[i].name, i+1, ext);
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
