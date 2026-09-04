// ========================================
// 📊 申請一覧・承認待ちの横断集約
// ========================================

function tripToPortalItem_(trip, app) {
  return {
    appCode: app.appCode,
    appName: app.appName,
    dataType: 'trip',
    requestId: trip.tripRequestId,
    requestDate: trip.requestDate,
    applicantEmail: trip.applicantEmail,
    applicantName: trip.applicantName,
    title: trip.destination,
    subtitle: trip.purpose,
    status: trip.status,
    extraStatus: trip.settlementStatus,
    tripStart: trip.tripStart,
    tripEnd: trip.tripEnd,
    amount: trip.advancePayment,
    approverEmail: trip.approverEmail,
    routeId: trip.routeId,
    currentStep: trip.currentStep,
    totalSteps: trip.totalSteps,
    currentStepName: trip.currentStepName,
    updatedAt: trip.updatedAt,
    webAppUrl: app.webAppUrl || ''
  };
}

function claimToPortalItem_(claim, app) {
  return {
    appCode: app.appCode,
    appName: app.appName,
    dataType: 'claim',
    requestId: claim.claimId,
    requestDate: claim.claimDate,
    applicantEmail: claim.applicantEmail,
    applicantName: claim.applicantName,
    title: claim.destination,
    subtitle: claim.purpose,
    status: claim.status,
    extraStatus: claim.tripRequestId ? '出張:' + claim.tripRequestId : '',
    tripStart: claim.tripStart,
    tripEnd: claim.tripEnd,
    amount: normalizeAmount(claim.totalAmount) + normalizeAmount(claim.perDiemTotal),
    approverEmail: claim.approverEmail,
    routeId: '',
    currentStep: 0,
    totalSteps: 0,
    currentStepName: '',
    updatedAt: claim.updatedAt,
    webAppUrl: app.webAppUrl || ''
  };
}

function leaveToPortalItem_(leave, app) {
  leave = leave || {};
  return {
    appCode: app.appCode,
    appName: app.appName,
    dataType: 'leave',
    requestId: leave.leaveRequestId,
    requestDate: leave.applicationDate || leave.submittedAt || '',
    applicantEmail: leave.applicantEmail,
    applicantName: leave.employeeName,
    title: leave.leaveType,
    subtitle: leave.durationType || leave.reason || '',
    status: leave.status,
    extraStatus: leave.department || '',
    tripStart: leave.acquisitionDate,
    tripEnd: leave.acquisitionDate,
    amount: 0,
    approverEmail: leave.currentApproverEmail,
    routeId: leave.routeId || '',
    currentStep: leave.currentStep || 0,
    totalSteps: leave.totalSteps || 0,
    currentStepName: leave.currentStepName || '',
    updatedAt: leave.updatedAt || leave.submittedAt || '',
    webAppUrl: app.webAppUrl || ''
  };
}

function isLeavePendingForPortalUser_(item, userEmail) {
  if (!item || item.dataType !== 'leave') return false;
  userEmail = String(userEmail || '').trim().toLowerCase();
  if (!userEmail) return false;
  if (!isLeaveWaitingStatusForPortal_(item.status)) return false;
  return isLeaveCurrentStepCandidateForPortal_(item, userEmail);
}

function purchaseToPortalItem_(purchase, app) {
  return {
    appCode: app.appCode,
    appName: app.appName,
    dataType: 'purchase',
    requestId: purchase.purchaseRequestId,
    requestDate: purchase.requestDate,
    applicantEmail: purchase.applicantEmail,
    applicantName: purchase.applicantName,
    title: purchase.itemName,
    subtitle: purchase.purpose,
    status: purchase.status,
    extraStatus: purchase.supplier || '',
    masterStatus: purchase.masterStatus || '登録済',
    unregisteredMasterCount: purchase.unregisteredMasterCount || 0,
    tripStart: purchase.desiredDate,
    tripEnd: purchase.desiredDate,
    amount: (purchase.currency && purchase.currency !== 'JPY')
      ? (purchase.estimatedJpyAmount || purchase.totalAmount)
      : purchase.totalAmount,
    currency: purchase.currency || 'JPY',
    exchangeRate: purchase.exchangeRate || 1,
    estimatedJpyAmount: purchase.estimatedJpyAmount || purchase.totalAmount,
    originalAmount: purchase.totalAmount,
    approverEmail: purchase.approverEmail,
    routeId: purchase.routeId,
    currentStep: purchase.currentStep,
    totalSteps: purchase.totalSteps,
    currentStepName: purchase.currentStepName,
    updatedAt: purchase.updatedAt,
    webAppUrl: app.webAppUrl || ''
  };
}

function isPurchaseMasterPendingNotice_(item, employee) {
  return item && item.dataType === 'purchase' &&
    item.status === PURCHASE_STATUS.APPROVED &&
    item.masterStatus === 'マスタ未登録あり' &&
    employeeHasRole_(employee, 'ワークフロー管理者');
}

function canViewApplication_(app, record, userEmail) {
  if (!record || !userEmail) return false;
  var dataType = String((app && app.dataType) || record.dataType || '').trim().toLowerCase();
  if (dataType === 'purchase' &&
      record.status === PURCHASE_STATUS.APPROVED &&
      record.masterStatus === 'マスタ未登録あり' &&
      employeeHasRole_(findEmployeeByEmail(userEmail), 'ワークフロー管理者')) {
    return true;
  }
  if (dataType === 'leave') {
    var leaveEmail = String(userEmail || '').trim().toLowerCase();
    if (String(record.applicantEmail || '').trim().toLowerCase() === leaveEmail) return true;
    if (!isLeaveWaitingStatusForPortal_(record.status)) return false;
    return isLeaveCurrentStepCandidateForPortal_(record, leaveEmail);
  }
  return record.applicantEmail === userEmail || record.approverEmail === userEmail;
}

function getApplicationDetail(appCode, requestId) {
  var app = getPortalAppByCode_(appCode);
  if (!app || !String(app.ssId || '').trim()) {
    return { success: false, message: 'アプリ設定が見つかりません。' };
  }
  if (!isSupportedDataType_(app.dataType)) {
    return { success: false, message: '未対応のデータ種別です。' };
  }
  return getApplicationDetailByType_(app, requestId, getCurrentUserEmail_());
}

function getPortalInitialData(options) {
  options = options || {};
  var userEmail = getCurrentUserEmail_();

  if (options.useCache !== false && userEmail) {
    var cacheMark = portalPerfStart_('getPortalInitialData.cache');
    var cached = getCachedJson_(portalDataCacheKey_(userEmail));
    portalPerfEnd_(cacheMark, cached ? 'hit' : 'miss');
    if (cached) {
      Logger.log('[portal-perf] getPortalInitialData: cache=hit my=' +
        (cached.myApplications || []).length + ' pending=' + (cached.pendingApprovals || []).length);
      console.log('[portal-perf] getPortalInitialData: cache=hit');
      return cached;
    }
  } else {
    Logger.log('[portal-perf] getPortalInitialData: cache=skip (force reload)');
    console.log('[portal-perf] getPortalInitialData: cache=skip (force reload)');
  }

  var data = buildPortalInitialData_();
  if (userEmail) {
    putCachedJson_(portalDataCacheKey_(userEmail), data, PORTAL_DATA_CACHE_TTL_SEC);
  }
  return data;
}

function buildPortalInitialData_() {
  var totalMark = portalPerfStart_('buildPortalInitialData_');
  var userEmail = getCurrentUserEmail_();

  var employeeMark = portalPerfStart_('findEmployeeByEmail');
  var employee = findEmployeeByEmail(userEmail);
  portalPerfEnd_(employeeMark);
  var isMasterAdmin = employeeHasRole_(employee, 'ワークフロー管理者');

  var myApplications = [];
  var pendingApprovals = [];

  if (userEmail) {
    var appsMark = portalPerfStart_('getActivePortalApps_');
    var apps = getActivePortalApps_();
    portalPerfEnd_(appsMark, 'apps=' + apps.length);

    var collectMark = portalPerfStart_('collectAllApps');
    collectPortalItemsFromApps_(apps, { useAppCache: true }).forEach(function(item) {
      if (item.dataType === 'leave') {
        var leaveEmail = String(userEmail || '').trim().toLowerCase();
        if (String(item.applicantEmail || '').trim().toLowerCase() === leaveEmail) {
          myApplications.push(item);
        }
        if (isPendingRecord_(item, item.dataType, userEmail)) {
          pendingApprovals.push(item);
        }
        return;
      }
      if (item.applicantEmail === userEmail) myApplications.push(item);
      if (isPendingRecord_(item, item.dataType, userEmail) || isPurchaseMasterPendingNotice_(item, employee)) {
        pendingApprovals.push(item);
      }
    });
    portalPerfEnd_(collectMark, 'my=' + myApplications.length + ' pending=' + pendingApprovals.length);

    var sortMark = portalPerfStart_('sortLists');
    myApplications.sort(function(a, b) {
      return (b.updatedAt || b.requestDate || '').localeCompare(a.updatedAt || a.requestDate || '');
    });
    pendingApprovals.sort(function(a, b) {
      return (a.requestDate || '').localeCompare(b.requestDate || '');
    });
    portalPerfEnd_(sortMark);
  }

  var launchersMark = portalPerfStart_('getPortalLaunchers_');
  var launchers = getPortalLaunchers_();
  portalPerfEnd_(launchersMark, 'launchers=' + launchers.length);

  var warningsMark = portalPerfStart_('getPortalConfigWarnings_');
  var configWarnings = getPortalConfigWarnings_();
  portalPerfEnd_(warningsMark, 'warnings=' + configWarnings.length);

  var workflowMark = portalPerfStart_('isWorkflowLinked_');
  var workflowLinked = isWorkflowLinked_();
  portalPerfEnd_(workflowMark, 'linked=' + workflowLinked);

  portalPerfEnd_(totalMark, 'my=' + myApplications.length + ' pending=' + pendingApprovals.length);

  return {
    userEmail: userEmail,
    employee: employee,
    isMasterAdmin: isMasterAdmin,
    launchers: launchers,
    myApplications: myApplications,
    pendingApprovals: pendingApprovals,
    configWarnings: configWarnings,
    workflowLinked: workflowLinked
  };
}

function refreshPortalData() {
  clearPortalDataCache_(getCurrentUserEmail_());
  return getPortalInitialData({ useCache: false });
}

function getPendingPurchaseMasterCandidatesForPortal_() {
  return portalPerfRun_('getPendingPurchaseMasterCandidatesForPortal_', function() {
    if (!employeeHasRole_(findEmployeeByEmail(getCurrentUserEmail_()), 'ワークフロー管理者')) {
      return { success: false, message: '未登録マスタ管理の権限がありません。', candidates: [] };
    }

    var candidates = [];
    getActivePortalApps_().forEach(function(app) {
      if (String(app.dataType || '').trim().toLowerCase() !== 'purchase') return;
      readUnregisteredPurchaseMastersFromApp_(app, function(row) {
        return row.status === '未登録';
      }).forEach(function(row) {
        candidates.push(row);
      });
    });
    candidates.sort(function(a, b) {
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
    Logger.log('[portal-perf] getPendingPurchaseMasterCandidatesForPortal_ | candidates=' + candidates.length);
    console.log('[portal-perf] getPendingPurchaseMasterCandidatesForPortal_ | candidates=' + candidates.length);
    return { success: true, candidates: candidates };
  });
}

function registerPendingPurchaseMasterCandidatesFromPortal_(updates) {
  if (!employeeHasRole_(findEmployeeByEmail(getCurrentUserEmail_()), 'ワークフロー管理者')) {
    return { success: false, message: '未登録マスタ管理の権限がありません。' };
  }
  updates = updates || [];
  if (!updates.length) return { success: false, message: '登録対象がありません。' };

  var byApp = {};
  updates.forEach(function(update) {
    var appCode = String(update.appCode || '').trim();
    var candidateId = String(update.candidateId || '').trim();
    if (!appCode || !candidateId) return;
    if (!byApp[appCode]) byApp[appCode] = {};
    byApp[appCode][candidateId] = {
      officialName: String(update.officialName || '').trim(),
      code: String(update.code || '').trim(),
      aliases: String(update.aliases || '').trim()
    };
  });

  var now = formatDateTime(new Date());
  var userEmail = getCurrentUserEmail_();
  var processed = 0;
  var messages = [];

  Object.keys(byApp).forEach(function(appCode) {
    var app = getPortalAppByCode_(appCode);
    if (!app || String(app.dataType || '').trim().toLowerCase() !== 'purchase') return;

    var targetMap = byApp[appCode];
    var rows = readUnregisteredPurchaseMastersFromApp_(app);
    var affected = {};

    rows.forEach(function(row) {
      var update = targetMap[row.candidateId];
      if (!update || row.status !== '未登録') return;
      if (!update.officialName) {
        messages.push(app.appName + ' / ' + row.type + '「' + row.inputName + '」: 正式表示名が未入力です。');
        return;
      }

      row.officialName = update.officialName;
      row.code = update.code;
      row.aliases = update.aliases;
      row.officialName = appendOrMergePurchaseMasterRowFromPortal_(
        app,
        row.type,
        row.code,
        row.officialName,
        mergePurchaseMasterAliasValues_(row.inputName, row.aliases)
      );
      applyOfficialPurchaseMasterNameFromPortal_(app, row);
      row.status = '登録済';
      row.updatedAt = now;
      row.registeredAt = now;
      row.processedBy = userEmail;
      affected[row.purchaseRequestId] = true;
      processed++;
    });

    writeUnregisteredPurchaseMastersToApp_(app, rows);
    rows = readUnregisteredPurchaseMastersFromApp_(app);
    Object.keys(affected).forEach(function(purchaseRequestId) {
      updatePurchaseMasterStatusFromPortal_(app, purchaseRequestId, rows);
    });
  });

  var result = getPendingPurchaseMasterCandidatesForPortal_();
  return {
    success: true,
    message: '正式登録処理が完了しました。\n登録: ' + processed + ' 件' +
      (messages.length ? '\n\n【未処理】\n' + messages.join('\n') : ''),
    candidates: result.candidates || [],
    data: refreshPortalData()
  };
}
