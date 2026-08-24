function doGet(e) {
  var params = (e && e.parameter) || {};
  var template = HtmlService.createTemplateFromFile('index');
  template.deepLinkTab = String(params.tab || '').trim();
  template.deepLinkForceReload = String(params.forceReload || '').trim();
  template.deepLinkApp = String(params.app || '').trim();
  template.deepLinkRequestId = String(params.requestId || '').trim();
  return template.evaluate()
    .setTitle('申請ポータル')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function refreshPortalAppsCacheApi() {
  clearPortalAppsCache_();
  clearAllPortalAppItemsCache_();
  ensureLeavePortalAppRegistered_();
  var apps = loadPortalApps_();
  return {
    success: !getPortalAppsLastLoadError_(),
    message: getPortalAppsLastLoadError_() || ('ポータルアプリ登録を再読込しました（' + apps.length + ' 件）'),
    apps: apps
  };
}

function getInitialAppData() {
  return portalPerfRun_('getInitialAppData', function() {
    return getPortalInitialData({ useCache: true });
  });
}

function refreshAppData() {
  return portalPerfRun_('refreshAppData', refreshPortalData);
}

function getApplicationDetailApi(appCode, requestId) {
  return getApplicationDetail(appCode, requestId);
}

function approveApplicationApi(appCode, requestId, comment) {
  var res = approveApplication(appCode, requestId, comment);
  if (res.success) {
    res.data = refreshPortalData();
  }
  return res;
}

function rejectApplicationApi(appCode, requestId, reason, rejectTargetChoice) {
  var res = rejectApplication(appCode, requestId, reason, rejectTargetChoice);
  if (res.success) {
    res.data = refreshPortalData();
  }
  return res;
}

function getPendingPurchaseMasterCandidatesApi() {
  return portalPerfRun_('getPendingPurchaseMasterCandidatesApi', getPendingPurchaseMasterCandidatesForPortal_);
}

function registerPendingPurchaseMasterCandidatesApi(updates) {
  return registerPendingPurchaseMasterCandidatesFromPortal_(updates);
}
