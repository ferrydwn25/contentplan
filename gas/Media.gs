/**
 * ============================================================================
 * Media.gs — DRAFT (bukan kode Apps Script asli Ferry)
 * ============================================================================
 * STATUS: DRAFT. BELUM DIVERIFIKASI LEWAT DEPLOY.
 *
 * File ini disusun HANYA dari ringkasan browser atas proyek Apps Script
 * asli "Contentplan". Saya TIDAK membaca kode asli verbatim, jadi file ini
 * HARUS dibandingkan baris-per-baris dengan Media.gs asli di editor
 * Apps Script SEBELUM ditempel. Bila ada perbedaan, KODE ASLI yang menang.
 *
 * TODO VERIFIKASI KONTRAK (penting):
 * Vercel mengirim GET ?api=bootstrap / oauth_tokens / due_posts, sedangkan
 * aksi doGet asli yang tercatat adalah get_full_vercel_bootstrap_data /
 * get_oauth_connections dst. Ringkasan browser TIDAK mencatat nama
 * parameter yang dipakai doGet asli (api? action?). Code.gs di draft ini
 * menerima KEDUA bentuk sebagai alias. JANGAN ubah kontrak Vercel tanpa
 * verifikasi terhadap doGet asli. Lihat README-DRAFT.md.
 *
 * PERUBAHAN HARDENED DIBANDING ASLI (menurut ringkasan):
 * - uploadAssetToDrive() TIDAK LAGI otomatis ANYONE_WITH_LINK. Default:
 *   file tetap privat (hanya pemilik). Berbagi publik HANYA bila payload
 *   secara eksplisit menyertakan sharePublic === true, dan kejadian itu
 *   dicatat di ACTIVITY_LOG.
 * - Tambah validasi jenis file (allowlist MIME di Config.gs) dan ukuran
 *   maksimal (MAX_MEDIA_BYTES). File yang tidak lolos ditolak dengan
 *   error yang jelas, bukan diunggah diam-diam.
 * - Nama folder aset dipertahankan: ContentPlan_Assets.
 * ============================================================================
 */

var MEDIA_FOLDER_NAME = 'ContentPlan_Assets';

function _getOrCreateMediaFolder_() {
  var folders = DriveApp.getFoldersByName(MEDIA_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(MEDIA_FOLDER_NAME);
}

function getMediaFiles(brandName) {
  var all = DB_getAll(SHEET_NAMES.mediaLibrary);
  if (brandName && brandName !== 'ALL') {
    return all.filter(function (m) { return String(m.brand_name) === String(brandName); });
  }
  return all;
}

/**
 * Upload aset dari base64.
 * payload: { fileName, mimeType, base64Data, brand_name, sharePublic }
 * sharePublic HARUS true secara eksplisit untuk berbagi publik; default privat.
 */
function uploadAssetToDrive(payload) {
  try {
    if (!payload || !payload.fileName || !payload.base64Data) {
      return { success: false, error: 'fileName dan base64Data wajib diisi.' };
    }
    var mimeType = String(payload.mimeType || 'application/octet-stream');
    if (ALLOWED_MEDIA_MIME_TYPES.indexOf(mimeType) === -1) {
      return { success: false, error: 'Jenis file tidak diizinkan: ' + mimeType + '.' };
    }
    var bytes = Utilities.base64Decode(payload.base64Data);
    if (bytes.length > MAX_MEDIA_BYTES) {
      return {
        success: false,
        error: 'File terlalu besar (' + bytes.length + ' byte). Maksimal ' + MAX_MEDIA_BYTES + ' byte.'
      };
    }
    var folder = _getOrCreateMediaFolder_();
    var blob = Utilities.newBlob(bytes, mimeType, payload.fileName);
    var file = folder.createFile(blob);

    var sharePublic = payload.sharePublic === true;
    if (sharePublic) {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      logActivity('upload_media_public', 'File dibagikan publik atas permintaan eksplisit: ' + payload.fileName);
    } else {
      /* Default: privat. Jangan panggil setSharing sama sekali. */
      logActivity('upload_media', 'File diunggah (privat): ' + payload.fileName);
    }

    var fileId = file.getId();
    DB_insert(SHEET_NAMES.mediaLibrary, {
      file_id: fileId,
      file_name: payload.fileName,
      mime_type: mimeType,
      file_url: 'https://drive.google.com/file/d/' + fileId + '/view',
      brand_name: payload.brand_name || '',
      uploaded_at: new Date().toISOString()
    });
    return { success: true, file_id: fileId, share_public: sharePublic };
  } catch (e) {
    console.error('uploadAssetToDrive error: ' + e.message);
    return { success: false, error: e.message };
  }
}

function deleteMediaFile(fileId) {
  try {
    if (!fileId) return { success: false, error: 'fileId wajib diisi.' };
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (e) {
      /* File Drive mungkin sudah tidak ada; tetap hapus baris metadata. */
      console.error('deleteMediaFile Drive: ' + e.message);
    }
    var res = DB_delete(SHEET_NAMES.mediaLibrary, fileId, 'file_id');
    if (!res.success) return { success: false, error: 'Metadata file tidak ditemukan.' };
    logActivity('delete_media', 'File dihapus: ' + fileId);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
