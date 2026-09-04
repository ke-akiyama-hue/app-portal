// ========================================
// 🔗 ワークフロー設定アプリ連携（承認操作用）
// ========================================

var WF_SHEET_ROUTES = '申請経路マスタ';
var WF_SHEET_STEPS = '申請経路ステップ';
var WF_ROUTE_STATUS_COMPLETE = '完成';
var WF_STEP_TYPE_FIXED = '固定ユーザー';
var WF_STEP_TYPE_LEGACY_SUPERVISOR = '申請者の上長';
var WF_RESOLVE_ROLE_IN_ORG = '選択したロール内の指定した組織に所属するユーザーが承認';
var WF_RESOLVE_WF_ADMIN = '指定した組織のワークフロー管理者が承認';
var WF_RESOLVE_ORG_APPROVER = '組織内承認者が承認';
var WF_RESOLVE_ALL_IN_ORG = '組織に所属するすべてのユーザーが承認';
var WF_ADMIN_ROLE_NAME = 'ワークフロー管理者';
var WF_ORG_APPROVER_ROLES = ['課長', '事業所長', '部長', '工場長', '所長', 'マネージャー'];
var WF_APPROVAL_ROLE_APPROVER = '承認者';
var WF_APPROVAL_CONDITION_ONE_OR_MORE = '1人以上が承認';
var WF_REJECT_TARGET_PREVIOUS = 'ひとつ前の決裁者';
var WF_REJECT_TARGET_APPLICANT = '申請者';
var WF_REJECT_TARGET_ON_REJECT = '差戻し時に選択';
var WF_STEP_COL_COUNT = 11;

function isWorkflowLinked_() {
  return !!String(WORKFLOW_SS_ID || '').trim();
}

function openWorkflowSpreadsheet_() {
  if (!isWorkflowLinked_()) return null;
  try {
    return SpreadsheetApp.openById(WORKFLOW_SS_ID);
  } catch (e) {
    Logger.log('ワークフローブック open エラー: ' + e.message);
    return null;
  }
}

function readWorkflowSheetRows_(sheetName, colCount, mapFn, cacheKey) {
  if (!isWorkflowLinked_()) return [];
  var cached = getCachedJson_(cacheKey);
  if (cached) return cached;

  var ss = openWorkflowSpreadsheet_();
  if (!ss) return [];
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) {
    putCachedJson_(cacheKey, []);
    return [];
  }
  var data = sheet.getRange(2, 1, sheet.getLastRow(), Math.max(colCount, sheet.getLastColumn())).getValues();
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    if (!data[i][0]) continue;
    rows.push(mapFn(data[i]));
  }
  putCachedJson_(cacheKey, rows);
  return rows;
}

function loadWorkflowRoutes_() {
  return readWorkflowSheetRows_(WF_SHEET_ROUTES, 7, function(d) {
    return {
      routeId: String(d[0] || '').trim(),
      routeName: String(d[1] || '').trim(),
      status: String(d[2] || '').trim()
    };
  }, 'wf_routes_' + WORKFLOW_SS_ID);
}

function loadWorkflowSteps_() {
  return readWorkflowSheetRows_(WF_SHEET_STEPS, WF_STEP_COL_COUNT, function(d) {
    return {
      routeId: String(d[0] || '').trim(),
      stepNo: parseInt(d[1], 10) || 0,
      stepName: String(d[2] || '').trim(),
      approverType: String(d[3] || '').trim(),
      approverEmail: String(d[4] || '').trim().toLowerCase(),
      approvalRole: String(d[5] || WF_APPROVAL_ROLE_APPROVER).trim() || WF_APPROVAL_ROLE_APPROVER,
      approvalCondition: String(d[6] || WF_APPROVAL_CONDITION_ONE_OR_MORE).trim() || WF_APPROVAL_CONDITION_ONE_OR_MORE,
      rejectTarget: String(d[7] || WF_REJECT_TARGET_APPLICANT).trim() || WF_REJECT_TARGET_APPLICANT,
      targetOffice: String(d[8] || '').trim(),
      targetDepartment: String(d[9] || '').trim(),
      targetRole: String(d[10] || '').trim()
    };
  }, 'wf_steps_' + WORKFLOW_SS_ID);
}

function wfNormalizeOrg_(value, fallback) {
  var v = String(value || '').trim();
  if (!v || v === '(申請者と同じ)') return String(fallback || '').trim();
  return v;
}

function wfFilterByOrg_(employees, office, department) {
  office = String(office || '').trim();
  department = String(department || '').trim();
  return employees.filter(function(e) {
    if (office && e.office !== office) return false;
    if (department && !employeeMatchesDepartmentFilter_(e, department)) return false;
    return true;
  });
}

function wfIsOfficeWideApproverRole_(role) {
  role = String(role || '').trim();
  return role === '事業所長' || role === '工場長' || role === '所長';
}

function wfFilterByRoleOrg_(employees, office, department, role) {
  // 事業所長などは部署ではなく、申請者と同じ事業所内のロールで解決する。
  var effectiveDepartment = wfIsOfficeWideApproverRole_(role) ? '' : department;
  return wfFilterByOrg_(employees, office, effectiveDepartment).filter(function(e) {
    return employeeHasRole_(e, role);
  });
}

function wfUniqueEmails_(employees) {
  var seen = {}, out = [];
  employees.forEach(function(e) {
    if (e.email && !seen[e.email]) { seen[e.email] = true; out.push(e.email); }
  });
  return out;
}

function wfIsOrgApproverRole_(role) {
  role = String(role || '').trim();
  if (!role) return false;
  if (role.indexOf('承認') !== -1) return true;
  for (var i = 0; i < WF_ORG_APPROVER_ROLES.length; i++) {
    if (role === WF_ORG_APPROVER_ROLES[i] || role.indexOf(WF_ORG_APPROVER_ROLES[i]) !== -1) return true;
  }
  return false;
}

function resolveWorkflowStepApprovers_(step, applicantEmail) {
  var applicant = findEmployeeByEmail(applicantEmail) || {};
  var office = wfNormalizeOrg_(step.targetOffice, applicant.office);
  var department = wfNormalizeOrg_(step.targetDepartment, applicant.department);
  var employees = loadEmployeesFromSheet();
  var type = String(step.approverType || '').trim();
  var emails = [];

  if (type === WF_STEP_TYPE_FIXED) {
    var fixed = String(step.approverEmail || '').trim().toLowerCase();
    if (fixed) emails = [fixed];
  } else if (type === WF_STEP_TYPE_LEGACY_SUPERVISOR) {
    return null;
  } else if (type === WF_RESOLVE_ROLE_IN_ORG) {
    var role = String(step.targetRole || '').trim();
    if (!role) return null;
    emails = wfUniqueEmails_(wfFilterByRoleOrg_(employees, office, department, role));
  } else if (type === WF_RESOLVE_WF_ADMIN) {
    emails = wfUniqueEmails_(wfFilterByOrg_(employees, office, department).filter(function(e) {
      return employeeHasRole_(e, WF_ADMIN_ROLE_NAME);
    }));
  } else if (type === WF_RESOLVE_ORG_APPROVER) {
    var inOrg = wfFilterByOrg_(employees, office, department);
    var map = {};
    inOrg.forEach(function(e) {
      if (employeeHasOrgApproverRole_(e) && e.email) map[e.email] = true;
    });
    emails = Object.keys(map);
  } else if (type === WF_RESOLVE_ALL_IN_ORG) {
    emails = wfUniqueEmails_(wfFilterByOrg_(employees, office, department));
  } else {
    return null;
  }

  if (!emails.length) return null;
  return { emails: emails, primaryEmail: emails[0], approverCount: emails.length };
}

function leaveStepNameExactMatch_(storedName, routeStepName) {
  storedName = String(storedName || '').trim();
  routeStepName = String(routeStepName || '').trim();
  return !!(storedName && routeStepName && storedName === routeStepName);
}

function leaveStepNameSuffixMatch_(storedName, routeStepName) {
  storedName = String(storedName || '').trim();
  routeStepName = String(routeStepName || '').trim();
  if (!storedName || !routeStepName) return false;
  if (storedName === routeStepName) return true;
  var storedKey = storedName.replace(/承認$/, '');
  var routeKey = routeStepName.replace(/承認$/, '');
  if (!storedKey || !routeKey) return false;
  if (storedKey === '承認' || routeKey === '承認') return false;
  return storedKey === routeKey;
}

function findPortalLeaveWorkflowStepByName_(routeId, stepName) {
  routeId = String(routeId || '').trim();
  stepName = String(stepName || '').trim();
  if (!routeId || !stepName) return null;
  var steps = loadWorkflowSteps_()
    .filter(function(s) { return s.routeId === routeId; })
    .sort(function(a, b) { return a.stepNo - b.stepNo; });
  var i;
  for (i = 0; i < steps.length; i++) {
    if (leaveStepNameExactMatch_(stepName, steps[i].stepName)) return steps[i];
  }
  for (i = 0; i < steps.length; i++) {
    if (leaveStepNameSuffixMatch_(stepName, steps[i].stepName)) return steps[i];
  }
  return null;
}

function resolveLeaveDeptHeadApproverEmails_(step, applicantEmail) {
  var applicant = findEmployeeByEmail(applicantEmail) || {};
  var office = wfNormalizeOrg_(step.targetOffice, applicant.office);
  var department = wfNormalizeOrg_(step.targetDepartment, applicant.department);
  var employees = loadEmployeesFromSheet();
  var kacho = wfUniqueEmails_(wfFilterByRoleOrg_(employees, office, department, '課長'));
  if (kacho.length) return kacho;
  return wfUniqueEmails_(wfFilterByRoleOrg_(employees, office, department, '次長'));
}

function normalizeLeaveApproverEmails_(emails) {
  var seen = {};
  var out = [];
  (emails || []).forEach(function(email) {
    var v = String(email || '').trim().toLowerCase();
    if (!v || seen[v]) return;
    seen[v] = true;
    out.push(v);
  });
  return out;
}

function leaveApproverEmailsInclude_(emails, userEmail) {
  userEmail = String(userEmail || '').trim().toLowerCase();
  if (!userEmail || !emails || !emails.length) return false;
  for (var i = 0; i < emails.length; i++) {
    if (String(emails[i] || '').trim().toLowerCase() === userEmail) return true;
  }
  return false;
}

function resolveLeaveCurrentStepApproverEmails_(applicantEmail, routeId, currentStepName) {
  var step = findPortalLeaveWorkflowStepByName_(routeId, currentStepName);
  if (!step) return [];
  if (String(step.approverType || '').trim() === '部署長') {
    return normalizeLeaveApproverEmails_(resolveLeaveDeptHeadApproverEmails_(step, applicantEmail));
  }
  var match = resolveWorkflowStepApprovers_(step, applicantEmail);
  if (!match || !match.emails || !match.emails.length) return [];
  return normalizeLeaveApproverEmails_(match.emails);
}

function isLeaveCurrentStepCandidateForPortal_(item, userEmail) {
  userEmail = String(userEmail || '').trim().toLowerCase();
  if (!item || !userEmail) return false;
  var emails = resolveLeaveCurrentStepApproverEmails_(
    item.applicantEmail,
    item.routeId,
    item.currentStepName
  );
  if (emails && emails.length) {
    return leaveApproverEmailsInclude_(emails, userEmail);
  }
  var saved = String(item.approverEmail || item.currentApproverEmail || '').trim().toLowerCase();
  return !!saved && saved === userEmail;
}

function explainStepResolveFailure_(step, applicantEmail) {
  step = step || {};
  var type = String(step.approverType || '').trim();
  var label = 'ステップ' + (step.stepNo || '?') + '「' + (step.stepName || '') + '」';
  if (type === WF_STEP_TYPE_FIXED) {
    return label + ': 固定承認者Emailが未設定です。';
  }
  if (type === WF_RESOLVE_ROLE_IN_ORG) {
    return label + ': ロール「' + (step.targetRole || '未設定') + '」の承認者が見つかりません。';
  }
  return label + ': 承認者を解決できません。';
}

function resolveWorkflowSteps_(routeId, applicantEmail) {
  routeId = String(routeId || '').trim();
  if (!routeId) return [];

  var steps = loadWorkflowSteps_()
    .filter(function(s) { return s.routeId === routeId; })
    .sort(function(a, b) { return a.stepNo - b.stepNo; });

  var resolved = [];
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    var match = resolveWorkflowStepApprovers_(step, applicantEmail);
    if (!match || !match.primaryEmail) return [];
    resolved.push({
      stepNo: step.stepNo,
      stepName: step.stepName,
      approverType: step.approverType,
      approverEmail: match.primaryEmail,
      approverEmails: match.emails,
      approverCount: match.approverCount,
      approvalRole: step.approvalRole || WF_APPROVAL_ROLE_APPROVER,
      approvalCondition: step.approvalCondition || WF_APPROVAL_CONDITION_ONE_OR_MORE,
      rejectTarget: step.rejectTarget || WF_REJECT_TARGET_APPLICANT
    });
  }
  return resolved;
}

function getWorkflowStep_(routeId, applicantEmail, stepNo) {
  var steps = resolveWorkflowSteps_(routeId, applicantEmail);
  stepNo = parseInt(stepNo, 10);
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].stepNo === stepNo) return steps[i];
  }
  return null;
}

function getNextWorkflowStep_(routeId, applicantEmail, currentStepNo) {
  var steps = resolveWorkflowSteps_(routeId, applicantEmail);
  var nextNo = parseInt(currentStepNo, 10) + 1;
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].stepNo === nextNo) return steps[i];
  }
  return null;
}

function enrichTripWithWorkflowStep_(trip) {
  if (!trip || !isWorkflowLinked_() || !trip.routeId || !trip.currentStep) return trip;
  var step = getWorkflowStep_(trip.routeId, trip.applicantEmail, trip.currentStep);
  if (!step) return trip;
  trip.currentApprovalRole = step.approvalRole;
  trip.currentApprovalCondition = step.approvalCondition;
  trip.currentRejectTarget = step.rejectTarget;
  return trip;
}

function resolveRejectRoute_(trip, rejectTargetChoice) {
  var step = getWorkflowStep_(trip.routeId, trip.applicantEmail, trip.currentStep);
  var target = step ? step.rejectTarget : WF_REJECT_TARGET_APPLICANT;
  if (target === WF_REJECT_TARGET_ON_REJECT) {
    target = String(rejectTargetChoice || '').trim() || WF_REJECT_TARGET_APPLICANT;
  }
  if (target === WF_REJECT_TARGET_PREVIOUS && trip.currentStep > 1) {
    var prev = getWorkflowStep_(trip.routeId, trip.applicantEmail, trip.currentStep - 1);
    if (prev) {
      return {
        mode: 'previous_step',
        stepNo: prev.stepNo,
        stepName: prev.stepName,
        approvalRole: prev.approvalRole,
        approverEmail: prev.approverEmail
      };
    }
  }
  return { mode: 'applicant' };
}

function previewWorkflowRoute_(routeId, applicantEmail) {
  applicantEmail = String(applicantEmail || '').trim();
  if (!applicantEmail) return { success: false, message: '申請者を特定できません。' };
  if (!isWorkflowLinked_()) return { success: false, message: 'ワークフローが未連携です。' };

  routeId = String(routeId || '').trim();
  if (!routeId) return { success: false, message: '経路IDがありません。' };

  var route = loadWorkflowRoutes_().filter(function(r) { return r.routeId === routeId; })[0];
  if (!route || route.status !== WF_ROUTE_STATUS_COMPLETE) {
    return { success: false, message: '経路が未完成または存在しません。' };
  }

  var rawSteps = loadWorkflowSteps_()
    .filter(function(s) { return s.routeId === routeId; })
    .sort(function(a, b) { return a.stepNo - b.stepNo; });
  if (!rawSteps.length) return { success: false, message: '承認ステップがありません。' };

  var steps = [];
  for (var i = 0; i < rawSteps.length; i++) {
    var step = rawSteps[i];
    var match = resolveWorkflowStepApprovers_(step, applicantEmail);
    if (!match || !match.primaryEmail) {
      return { success: false, message: explainStepResolveFailure_(step, applicantEmail) };
    }
    var names = displayNamesForEmails_(match.emails);
    steps.push({
      stepNo: step.stepNo,
      stepName: step.stepName,
      approvalRole: step.approvalRole || WF_APPROVAL_ROLE_APPROVER,
      approverNames: names,
      approverDisplay: names.join('、'),
      approverCount: match.approverCount
    });
  }

  return { success: true, routeId: routeId, routeName: route.routeName, steps: steps };
}

function previewWorkflowRouteApi(routeId, applicantEmail) {
  return previewWorkflowRoute_(routeId, applicantEmail);
}
