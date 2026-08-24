const seedItems = [
  { id: 1, name: '防災リュック', location: '玄関収納・下段', code: '4901234567890', status: 'good', memo: '水・ライト入り' },
  { id: 2, name: 'HDMIケーブル 2m', location: '書斎・右の引き出し', code: 'QR-HDMI-002', status: 'attention', memo: '予備。動作確認が必要' },
  { id: 3, name: '冬用の寝袋', location: '納戸・上段', code: '8809876543210', status: 'good', memo: '青い収納袋' }
];

const storageKey = 'stockroom-items';
const deletedKey = 'stockroom-deleted-items';
let items = JSON.parse(localStorage.getItem(storageKey) || 'null') || seedItems;
let cloudUser = null;
let cloudItems = null;
let cloudWriteQueue = Promise.resolve();
let stopCloudSync = null;
let editingItemId = null;
let editingImage = '';
let deletedItemIds = new Set(JSON.parse(localStorage.getItem(deletedKey) || '[]'));
let activeFilter = 'all';
let stream = null;
let detector = null;
let scanTimer = null;

const $ = (selector) => document.querySelector(selector);
const itemList = $('#itemList');
const statusLabels = { storage: '保管', display: '展示', 'in-use': '使用中', good: '保管', attention: '保管' };

function saveItems() {
  localStorage.setItem(storageKey, JSON.stringify(items));
  if (!cloudUser || !cloudItems) return;
  const itemsToSave = [...items];
  cloudWriteQueue = cloudWriteQueue.then(() => Promise.all(itemsToSave.map((item) => cloudItems.doc(String(item.id)).set(item)))).catch(() => showToast('クラウド保存に失敗しました'));
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function locations() { return [...new Set(items.map((item) => item.location))].sort(); }
function filteredItems() {
  const query = $('#searchInput').value.trim().toLowerCase();
  const location = $('#locationFilter').value;
  return items.filter((item) => {
    const matchesQuery = !query || [item.name, item.location, item.code, item.memo].some((value) => value.toLowerCase().includes(query));
    const matchesFilter = activeFilter === 'all';
    const matchesLocation = location === 'all' || item.location === location;
    return matchesQuery && matchesFilter && matchesLocation;
  });
}
function render() {
  $('#itemCount').textContent = items.length;
  $('#allCount').textContent = items.length;
  $('#locationCount').textContent = locations().length;
  const selectedLocation = $('#locationFilter').value;
  $('#locationFilter').innerHTML = '<option value="all">場所：すべて</option>' + locations().map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join('');
  $('#locationFilter').value = locations().includes(selectedLocation) ? selectedLocation : 'all';
  $('#locationCodeButton').hidden = $('#locationFilter').value === 'all';
  const visible = filteredItems();
  itemList.innerHTML = visible.map((item) => `<article class="item-card">${item.image ? `<img class="item-image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">` : ''}<div><div class="item-code">${escapeHtml(item.code)}</div><div class="item-name">${escapeHtml(item.name)}</div><div class="item-location">⌖ ${escapeHtml(item.location)}</div>${item.memo ? `<div class="item-memo">中身：${escapeHtml(item.memo)}</div>` : ''}</div><div class="item-right"><span class="status status-good">${statusLabels[item.status] || '保管'}</span><button class="edit-item" data-id="${item.id}" type="button">編集</button><button class="code-item" data-id="${item.id}" type="button">コード出力</button><button class="delete-item" data-id="${item.id}" type="button">削除</button></div></article>`).join('');
  $('#emptyState').hidden = items.length > 0 || visible.length > 0;
  if (items.length > 0 && visible.length === 0) { itemList.innerHTML = '<div class="empty-state"><h3>該当するアイテムがありません</h3><p>検索条件や場所の絞り込みを確認してください。</p></div>'; $('#emptyState').hidden = true; }
}
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); }
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; if (id === '#scannerModal') stopScanner(); }

async function startScanner() {
  openModal('#scannerModal');
  $('#scannerStatus').textContent = 'カメラを起動しています…';
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) { $('#scannerStatus').textContent = 'このブラウザではカメラ読み取りに対応していません。手入力をご利用ください。'; return; }
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const formats = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a'].filter((format) => supported.includes(format));
    detector = new BarcodeDetector({ formats });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    $('#cameraVideo').srcObject = stream;
    $('#scannerStatus').textContent = '読み取り待機中';
    scanTimer = setInterval(scanFrame, 350);
  } catch (error) { $('#scannerStatus').textContent = 'カメラを利用できません。手入力をご利用ください。'; }
}
async function scanFrame() {
  const video = $('#cameraVideo');
  if (!detector || video.readyState < 2) return;
  try { const codes = await detector.detect(video); if (codes.length) handleCode(codes[0].rawValue); } catch (error) { /* camera frame can fail while loading */ }
}
function handleCode(code) {
  stopScanner(); closeModal('#scannerModal'); $('#searchInput').value = code; activeFilter = 'all'; document.querySelectorAll('.filter-tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.filter === 'all')); render();
  const found = items.find((item) => item.code.toLowerCase() === code.toLowerCase());
  const locationItems = items.filter((item) => item.location.toLowerCase() === code.toLowerCase());
  if (!found && locationItems.length) { $('#searchInput').value = locationItems[0].location; render(); }
  showToast(found ? `「${found.name}」を表示しました` : locationItems.length ? `「${locationItems[0].location}」のアイテムを表示しました` : '該当なし。検索結果を確認してください');
}
function stopScanner() { if (scanTimer) clearInterval(scanTimer); scanTimer = null; if (stream) stream.getTracks().forEach((track) => track.stop()); stream = null; detector = null; }
async function initializeCloudSync() {
  const config = window.STOCKROOM_FIREBASE_CONFIG;
  if (!window.firebase || !config?.apiKey || !config.projectId) return;
  firebase.initializeApp(config);
  const auth = firebase.auth();
  $('#loginButton').hidden = false;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  $('#loginButton').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    const login = isMobile ? auth.signInWithRedirect(provider) : auth.signInWithPopup(provider);
    login.catch((error) => showToast(`ログインできませんでした（${error.code || '認証エラー'}）`));
  });
  auth.getRedirectResult().catch((error) => showToast(`ログインできませんでした（${error.code || '認証エラー'}）`));
  auth.onAuthStateChanged(async (user) => {
    cloudUser = user;
    if (!user) { $('#syncStatus').textContent = 'ログインして共有'; $('#loginButton').textContent = 'Googleでログイン'; return; }
    $('#syncStatus').textContent = `${user.displayName || user.email} と同期中`;
    $('#loginButton').textContent = 'ログイン済み';
    cloudItems = firebase.firestore().collection('users').doc(user.uid).collection('items');
    if (deletedItemIds.size) {
      await Promise.all([...deletedItemIds].map((itemId) => cloudItems.doc(itemId).delete()));
      deletedItemIds.clear();
      localStorage.setItem(deletedKey, '[]');
    }
    if (stopCloudSync) stopCloudSync();
    let firstSnapshot = true;
    stopCloudSync = cloudItems.onSnapshot((snapshot) => {
      if (!snapshot.empty) {
        items = snapshot.docs.map((doc) => doc.data());
        localStorage.setItem(storageKey, JSON.stringify(items));
        render();
      } else if (firstSnapshot && items.length) {
        saveItems();
      }
      firstSnapshot = false;
    }, () => showToast('クラウド同期に失敗しました'));
  });
}
function openCodeModal(item) {
  $('#codeTitle').textContent = item.name;
  $('#codeCaption').textContent = `${item.location} / ${item.code}`;
  $('#qrOutput').innerHTML = '';
  $('#barcodeOutput').innerHTML = '';
  if (window.QRCode) new QRCode($('#qrOutput'), { text: item.code, width: 170, height: 170, correctLevel: QRCode.CorrectLevel.M });
  if (window.JsBarcode) {
    JsBarcode('#barcodeOutput', item.code, { format: 'CODE128', width: 2, height: 60, displayValue: true, margin: 8 });
  }
  openModal('#codeModal');
}
function openLocationCodeModal(location) {
  $('#codeTitle').textContent = location;
  $('#codeCaption').textContent = `この場所の所持品：${items.filter((item) => item.location === location).length}件`;
  $('#qrOutput').innerHTML = '';
  $('#barcodeOutput').innerHTML = '';
  if (window.QRCode) new QRCode($('#qrOutput'), { text: location, width: 170, height: 170, correctLevel: QRCode.CorrectLevel.M });
  openModal('#codeModal');
}
$('#printCodeButton').addEventListener('click', () => window.print());
$('#downloadCodeButton').addEventListener('click', () => {
  const image = $('#qrOutput').querySelector('img, canvas');
  if (!image) return;
  const link = document.createElement('a');
  link.download = `${$('#codeTitle').textContent}-QR.png`;
  link.href = image.tagName === 'CANVAS' ? image.toDataURL('image/png') : image.src;
  link.click();
});

$('#searchInput').addEventListener('input', render);
$('#locationFilter').addEventListener('change', render);
$('#locationCodeButton').addEventListener('click', () => openLocationCodeModal($('#locationFilter').value));
$('#scanButton').addEventListener('click', startScanner);
$('#manualSearchButton').addEventListener('click', () => { const code = $('#manualCode').value.trim(); if (code) handleCode(code); });
function openNewItemForm() { editingItemId = null; editingImage = ''; $('#itemForm').reset(); $('#formTitle').textContent = 'アイテムを登録'; $('#formSubmit').textContent = '登録する'; openModal('#formModal'); }
$('#addButton').addEventListener('click', openNewItemForm);
$('#emptyAddButton').addEventListener('click', openNewItemForm);
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(`#${button.dataset.close}`)));
document.querySelectorAll('.filter-tab').forEach((tab) => tab.addEventListener('click', () => { activeFilter = tab.dataset.filter; document.querySelectorAll('.filter-tab').forEach((button) => button.classList.toggle('is-active', button === tab)); render(); }));
itemList.addEventListener('click', async (event) => { const editButton = event.target.closest('.edit-item'); if (editButton) { const item = items.find((entry) => entry.id === Number(editButton.dataset.id)); if (item) { editingItemId = item.id; editingImage = item.image || ''; $('#formTitle').textContent = 'アイテムを編集'; $('#formSubmit').textContent = '変更を保存'; $('#itemForm').elements.name.value = item.name; $('#itemForm').elements.location.value = item.location; $('#itemForm').elements.status.value = item.status === 'good' || item.status === 'attention' ? 'storage' : item.status; $('#itemForm').elements.code.value = item.code; $('#itemForm').elements.memo.value = item.memo || ''; openModal('#formModal'); } return; } const codeButton = event.target.closest('.code-item'); if (codeButton) { const item = items.find((entry) => entry.id === Number(codeButton.dataset.id)); if (item) openCodeModal(item); return; } const button = event.target.closest('.delete-item'); if (!button) return; const itemId = Number(button.dataset.id); deletedItemIds.add(String(itemId)); localStorage.setItem(deletedKey, JSON.stringify([...deletedItemIds])); items = items.filter((item) => item.id !== itemId); localStorage.setItem(storageKey, JSON.stringify(items)); render(); if (cloudUser && cloudItems) { cloudWriteQueue = cloudWriteQueue.then(() => cloudItems.doc(String(itemId)).delete()).catch(() => showToast('クラウドから削除できませんでした')); await cloudWriteQueue; } showToast('アイテムを削除しました'); });
$('#itemForm').addEventListener('submit', async (event) => { event.preventDefault(); const data = new FormData(event.target); const id = editingItemId || Date.now(); const file = data.get('image'); try { const image = file && file.size > 0 ? await readImage(file) : editingImage; const updated = { id, name: data.get('name').trim(), location: data.get('location').trim(), code: data.get('code').trim() || `STOCK-${id}`, status: data.get('status') || 'storage', image, memo: data.get('memo').trim() }; items = editingItemId ? items.map((item) => item.id === editingItemId ? updated : item) : [updated, ...items]; saveItems(); closeModal('#formModal'); render(); editingItemId = null; editingImage = ''; showToast('アイテムを保存しました'); } catch (error) { showToast('画像を保存できませんでした。小さい画像で試してください'); } });
function readImage(file) { return new Promise((resolve, reject) => { const image = new Image(); const reader = new FileReader(); reader.onload = () => { image.onload = () => { const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale)); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', 0.75)); }; image.onerror = reject; image.src = reader.result; }; reader.onerror = reject; reader.readAsDataURL(file); }); }
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); } if (event.key === 'Escape') { closeModal('#formModal'); closeModal('#scannerModal'); } });
render();
initializeCloudSync();
