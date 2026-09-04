// ========================================
// ⚡ 業務アプリ一覧の Sheets API 並列読取 + アプリ別キャッシュ
// openById を3回直列で呼ぶ代わりに UrlFetchApp.fetchAll で同時取得
// ========================================

/** Ctrl+End 整理後も余裕を持った読取上限行（ヘッダー含む） */
var PORTAL_SHEET_READ_MAX_ROW = 200;

function portalListSheetSpec_(dataType) {
  dataType = String(dataType || '').trim().toLowerCase();
  var range = 'A1:Z' + PORTAL_SHEET_READ_MAX_ROW;
  if (dataType === 'trip') return { sheetName: TRIP_SHEET, range: range };
  if (dataType === 'claim') return { sheetName: CLAIM_SHEET, range: range };
  if (dataType === 'purchase') return { sheetName: PURCHASE_SHEET, range: range };
  if (dataType === 'leave') return { sheetName: LEAVE_SHEET, range: range };
  return null;
}

function quoteSheetRange_(sheetName, a1Range) {
  return "'" + String(sheetName).replace(/'/g, "''") + "'!" + a1Range;
}

function fetchPortalSheetValuesParallel_(apps) {
  var fallback = {};
  apps.forEach(function(app) {
    if (app.appCode) fallback[app.appCode] = null;
  });

  var requests = [];
  var meta = [];

  apps.forEach(function(app) {
    var ssId = String(app.ssId || '').trim();
    if (!ssId || !isSupportedDataType_(app.dataType)) return;
    var spec = portalListSheetSpec_(app.dataType);
    if (!spec) return;
    var sheetRange = quoteSheetRange_(spec.sheetName, spec.range);
    requests.push({
      url: 'https://sheets.googleapis.com/v4/spreadsheets/' + ssId +
        '/values/' + encodeURIComponent(sheetRange) + '?majorDimension=ROWS',
      method: 'get',
      muteHttpExceptions: true
    });
    meta.push({ app: app, sheetRange: sheetRange });
  });

  if (!requests.length) return {};

  try {
    var token = ScriptApp.getOAuthToken();
    requests.forEach(function(req) {
      req.headers = { Authorization: 'Bearer ' + token };
    });

    var mark = portalPerfStart_('fetchPortalSheetValuesParallel_');
    var responses = UrlFetchApp.fetchAll(requests);
    portalPerfEnd_(mark, 'requests=' + requests.length);

    var result = {};
    for (var i = 0; i < responses.length; i++) {
      var app = meta[i].app;
      var resp = responses[i];
      if (resp.getResponseCode() !== 200) {
        var code = resp.getResponseCode();
        var bodyText = resp.getContentText();
        Logger.log('[portal-perf] Sheets API failed ' + portalPerfAppLabel_(app) +
          ' ' + code + ': ' + bodyText.substring(0, 200));
        if (code === 403 && bodyText.indexOf('has not been used') >= 0) {
          Logger.log('[portal-perf] → GCP で Google Sheets API を有効化してください。' +
            ' Apps Script エディタ左「サービス」→ Google Sheets API を追加、' +
            ' または https://console.cloud.google.com/apis/library/sheets.googleapis.com');
          console.log('[portal-perf] Sheets API 403: GCP で Google Sheets API を有効化してください');
        }
        result[app.appCode] = null;
        continue;
      }
      var body = JSON.parse(resp.getContentText());
      var values = body.values || [];
      // ヘッダーのみ／空配列は成功扱いにしない。承認直後の Sheets API が一瞬空を返すと
      // 休暇0件としてキャッシュされ、他申請まで承認待ちから消える。
      result[app.appCode] = isPortalParallelSheetValuesUsable_(values) ? values : null;
    }
    return result;
  } catch (e) {
    Logger.log('[portal-perf] fetchPortalSheetValuesParallel_ failed (SpreadsheetApp fallback): ' + e.message);
    console.log('[portal-perf] fetchPortalSheetValuesParallel_ failed (SpreadsheetApp fallback): ' + e.message);
    return fallback;
  }
}

function isPortalParallelSheetValuesUsable_(values) {
  return !!(values && values.length >= 2);
}

function authorizePortalParallelRead_() {
  return authorizePortalParallelRead();
}

function parseTripPortalItemsFromValues_(app, values) {
  if (!values || values.length < 2) return [];
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row || !row[0]) continue;
    items.push(tripToPortalItem_(mapTripRow_(row), app));
  }
  return items;
}

function parseClaimPortalItemsFromValues_(app, values) {
  if (!values || values.length < 2) return [];
  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var legacy = headers[0] === '申請ID' && headers.indexOf('出張申請ID') === -1;
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row || !row[0]) continue;
    var mapped = legacy ? mapLegacyClaimRow_(row) : mapClaimRow_(row);
    items.push(claimToPortalItem_(mapped, app));
  }
  return items;
}

function parsePurchasePortalItemsFromValues_(app, values) {
  if (!values || values.length < 2) return [];
  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var colMap = mapHeaderColumns_(headers);
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row || !row[0]) continue;
    items.push(purchaseToPortalItem_(mapPurchaseRow_(row, colMap), app));
  }
  return items;
}

function parseLeavePortalItemsFromValues_(app, values) {
  if (!values || values.length < 2) return [];
  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var colMap = mapHeaderColumns_(headers);
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row || !row[0]) continue;
    var mapped = mapLeaveRowFromPortal_(row, colMap);
    if (!mapped.leaveRequestId) continue;
    items.push(leaveToPortalItem_(mapped, app));
  }
  return items;
}

function parsePortalItemsFromSheetValues_(app, values) {
  var dataType = String(app.dataType || '').trim().toLowerCase();
  if (dataType === 'trip') return parseTripPortalItemsFromValues_(app, values);
  if (dataType === 'claim') return parseClaimPortalItemsFromValues_(app, values);
  if (dataType === 'purchase') return parsePurchasePortalItemsFromValues_(app, values);
  if (dataType === 'leave') return parseLeavePortalItemsFromValues_(app, values);
  return [];
}

function collectPortalItemsFromApps_(apps, options) {
  options = options || {};
  var useAppCache = options.useAppCache !== false;
  var preferDirectRead = options.preferDirectRead === true;
  var itemsByApp = {};
  var appsToFetch = [];
  var directApps = [];

  apps.forEach(function(app) {
    var code = app.appCode;
    var dataType = String(app.dataType || '').trim().toLowerCase();
    if (preferDirectRead && dataType === 'leave') {
      directApps.push(app);
      return;
    }
    if (useAppCache) {
      var cacheMark = portalPerfStart_('collectPortalItems.cache_' + portalPerfAppLabel_(app));
      var cached = getCachedJson_(portalAppItemsCacheKey_(code));
      portalPerfEnd_(cacheMark, cached ? 'hit items=' + cached.length : 'miss');
      if (cached) {
        itemsByApp[code] = cached;
        return;
      }
    }
    appsToFetch.push(app);
  });

  if (appsToFetch.length) {
    var fetchMark = portalPerfStart_('collectPortalItems.parallelFetch');
    var valuesByApp = fetchPortalSheetValuesParallel_(appsToFetch);
    var needFallback = [];

    appsToFetch.forEach(function(app) {
      var values = valuesByApp[app.appCode];
      if (!isPortalParallelSheetValuesUsable_(values)) {
        needFallback.push(app);
        return;
      }
      var parseMark = portalPerfStart_('collectPortalItems.parse_' + portalPerfAppLabel_(app));
      var items = parsePortalItemsFromSheetValues_(app, values);
      portalPerfEnd_(parseMark, 'items=' + items.length);
      if (useAppCache) {
        putCachedJson_(portalAppItemsCacheKey_(app.appCode), items, PORTAL_APP_ITEMS_CACHE_TTL_SEC);
      }
      itemsByApp[app.appCode] = items;
    });
    portalPerfEnd_(fetchMark, 'fetched=' + appsToFetch.length + ' fallback=' + needFallback.length);

    needFallback.forEach(function(app) {
      var items = collectItemsFromApp_(app, null);
      if (useAppCache) {
        putCachedJson_(portalAppItemsCacheKey_(app.appCode), items, PORTAL_APP_ITEMS_CACHE_TTL_SEC);
      }
      itemsByApp[app.appCode] = items;
    });
  }

  directApps.forEach(function(app) {
    var items = collectItemsFromApp_(app, null);
    if (useAppCache) {
      putCachedJson_(portalAppItemsCacheKey_(app.appCode), items, PORTAL_APP_ITEMS_CACHE_TTL_SEC);
    }
    itemsByApp[app.appCode] = items;
  });

  var all = [];
  apps.forEach(function(app) {
    (itemsByApp[app.appCode] || []).forEach(function(item) { all.push(item); });
  });
  return all;
}
