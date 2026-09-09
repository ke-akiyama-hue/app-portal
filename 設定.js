// ========================================
// ⚙️ 申請ポータル 共通設定
// ========================================

var MASTER_SS_ID = '1FrxPVUeKecY8SXwc5daMxjGT0MzQKZ_toa77PfO4iQo';
var EMPLOYEE_MASTER_SHEET_NAME = '社員マスタ';
var WORKFLOW_SS_ID = '19zhtLt23UOpysCpbwH9X-gom5ohVKbW2nARECDvCfIk';

/** 出張申請ステータス */
var TRIP_STATUS = {
  DRAFT: '下書き',
  SUBMITTED: '申請中',
  APPROVED: '承認済',
  REJECTED: '差戻し',
  CANCELLED: '取消'
};

var SETTLEMENT_STATUS = {
  NONE: '未精算',
  IN_PROGRESS: '精算中',
  DONE: '精算完了'
};

/** 旅費精算ステータス */
var CLAIM_STATUS = {
  DRAFT: '下書き',
  SUBMITTED: '申請中',
  APPROVED: '承認済',
  REJECTED: '差戻し',
  SETTLED: '精算完了'
};

/** 購買申請ステータス */
var PURCHASE_STATUS = {
  DRAFT: '下書き',
  SUBMITTED: '申請中',
  APPROVED: '承認済',
  REJECTED: '差戻し',
  WITHDRAWN: '取り下げ',
  CANCELLED: '取消'
};

/** 休暇届出申請の承認待ち系ステータス（休暇アプリの既存値をそのまま使用。申請中へ変換しない） */
var LEAVE_WAIT_STATUSES = [
  '係長承認待ち',
  '部署長承認待ち',
  '事業所長承認待ち',
  '常務承認待ち',
  '管理課承認待ち',
  '承認待ち',
  '再申請'
];

function isLeaveWaitingStatusForPortal_(status) {
  return LEAVE_WAIT_STATUSES.indexOf(String(status || '').trim()) >= 0;
}

/**
 * 業務アプリ登録はワークフロー設定ブックの「ポータルアプリ登録」シートで管理。
 * Web UI「ポータル連携」タブから随時追加可能（申請ポータルのコード変更不要）。
 */

/** 休暇・届出申請書（ポータル起動用） */
var LEAVE_PORTAL_APP_CODE = 'LEAVE_REQUEST';
var LEAVE_FORM_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbykWKUoG6bSdLsdAnlRAPVkoZjxTbXd-iAAnxrMFrlyMlGxJO2xFRU06rB5J2sTrm7iCA/exec';

var MASTER_CACHE_TTL_SEC = 600;

/** ポータル初期データ（申請一覧・承認待ち）のキャッシュ秒数 */
var PORTAL_DATA_CACHE_TTL_SEC = 120;

/** 業務アプリ別ポータル一覧（全ユーザー共通）のキャッシュ秒数。通常一覧はこれを使い、操作直後だけ直読して書き戻す */
var PORTAL_APP_ITEMS_CACHE_TTL_SEC = 120;

function portalDataCacheKey_(userEmail) {
  return 'portal_initial_' + String(userEmail || '').trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
}

function portalAppItemsCacheKey_(appCode) {
  return 'portal_app_items_' + String(appCode || '').trim();
}

function clearAllPortalAppItemsCache_() {
  try {
    var cache = CacheService.getScriptCache();
    loadPortalApps_().forEach(function(app) {
      var code = String(app.appCode || '').trim();
      if (code) cache.remove(portalAppItemsCacheKey_(code));
    });
  } catch (e) { /* ignore */ }
}

function clearPortalDataCache_(userEmail) {
  userEmail = String(userEmail || getCurrentUserEmail_() || '').trim().toLowerCase();
  if (userEmail) {
    try {
      CacheService.getScriptCache().remove(portalDataCacheKey_(userEmail));
    } catch (e) { /* ignore */ }
  }
  clearPortalAppsCache_();
  clearAllPortalAppItemsCache_();
}

function normalizeDate(dateInput) {
  var tz = Session.getScriptTimeZone();
  if (!dateInput) return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return Utilities.formatDate(dateInput, tz, 'yyyy-MM-dd');
  }
  var s = String(dateInput).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, '-');
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

function normalizeDateTime(dateInput) {
  var tz = Session.getScriptTimeZone();
  if (!dateInput) return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return Utilities.formatDate(dateInput, tz, 'yyyy-MM-dd HH:mm');
  }
  var s = String(dateInput).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return s.substring(0, 16);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.replace('T', ' ').substring(0, 16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + ' 09:00';
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, '-') + ' 09:00';
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm');
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
}

function formatDateTime(val) {
  if (!val) return '';
  var tz = Session.getScriptTimeZone();
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, tz, 'yyyy-MM-dd HH:mm:ss');
  }
  return String(val);
}

function normalizeAmount(val) {
  var n = parseInt(String(val || '0').replace(/[,，]/g, ''), 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

function getCurrentUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

function getCachedJson_(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

function putCachedJson_(key, value, expirationInSeconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), expirationInSeconds || MASTER_CACHE_TTL_SEC);
  } catch (e) { /* ignore */ }
}
