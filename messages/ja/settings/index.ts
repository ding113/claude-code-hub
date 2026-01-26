import clientVersions from "./clientVersions.json";
import common from "./common.json";
import config from "./config.json";
import data from "./data.json";
import errorRules from "./errorRules.json";
import errors from "./errors.json";
import logs from "./logs.json";
import nav from "./nav.json";
import notifications from "./notifications.json";
import prices from "./prices.json";
import requestFilters from "./requestFilters.json";
import sensitiveWords from "./sensitiveWords.json";
import strings from "./strings.json";

import providersAutoSort from "./providers/autoSort.json";
import providersBatchEdit from "./providers/batchEdit.json";
import providersFilter from "./providers/filter.json";
import providersGuide from "./providers/guide.json";
import providersInlineEdit from "./providers/inlineEdit.json";
import providersList from "./providers/list.json";
import providersSchedulingDialog from "./providers/schedulingDialog.json";
import providersSearch from "./providers/search.json";
import providersSection from "./providers/section.json";
import providersSort from "./providers/sort.json";
import providersStrings from "./providers/strings.json";
import providersTypes from "./providers/types.json";

import providersFormApiTest from "./providers/form/apiTest.json";
import providersFormButtons from "./providers/form/buttons.json";
import providersFormCommon from "./providers/form/common.json";
import providersFormDeleteDialog from "./providers/form/deleteDialog.json";
import providersFormErrors from "./providers/form/errors.json";
import providersFormFailureThresholdConfirmDialog from "./providers/form/failureThresholdConfirmDialog.json";
import providersFormKey from "./providers/form/key.json";
import providersFormMaxRetryAttempts from "./providers/form/maxRetryAttempts.json";
import providersFormModelRedirect from "./providers/form/modelRedirect.json";
import providersFormModelSelect from "./providers/form/modelSelect.json";
import providersFormName from "./providers/form/name.json";
import providersFormProviderTypes from "./providers/form/providerTypes.json";
import providersFormProxyTest from "./providers/form/proxyTest.json";
import providersFormQuickPaste from "./providers/form/quickPaste.json";
import providersFormSections from "./providers/form/sections.json";
import providersFormStrings from "./providers/form/strings.json";
import providersFormSuccess from "./providers/form/success.json";
import providersFormTitle from "./providers/form/title.json";
import providersFormUrl from "./providers/form/url.json";
import providersFormUrlPreview from "./providers/form/urlPreview.json";
import providersFormWebsiteUrl from "./providers/form/websiteUrl.json";

const providersForm = {
  ...providersFormStrings,
  ...providersFormCommon,
  apiTest: providersFormApiTest,
  buttons: providersFormButtons,
  common: providersFormCommon,
  deleteDialog: providersFormDeleteDialog,
  errors: providersFormErrors,
  failureThresholdConfirmDialog: providersFormFailureThresholdConfirmDialog,
  key: providersFormKey,
  maxRetryAttempts: providersFormMaxRetryAttempts,
  modelRedirect: providersFormModelRedirect,
  modelSelect: providersFormModelSelect,
  name: providersFormName,
  providerTypes: providersFormProviderTypes,
  proxyTest: providersFormProxyTest,
  quickPaste: providersFormQuickPaste,
  sections: providersFormSections,
  success: providersFormSuccess,
  title: providersFormTitle,
  url: providersFormUrl,
  urlPreview: providersFormUrlPreview,
  websiteUrl: providersFormWebsiteUrl,
};

const providers = {
  ...providersStrings,
  autoSort: providersAutoSort,
  batchEdit: providersBatchEdit,
  filter: providersFilter,
  form: providersForm,
  guide: providersGuide,
  inlineEdit: providersInlineEdit,
  list: providersList,
  schedulingDialog: providersSchedulingDialog,
  search: providersSearch,
  section: providersSection,
  sort: providersSort,
  types: providersTypes,
};

export default {
  nav,
  common,
  config,
  providers,
  prices,
  sensitiveWords,
  requestFilters,
  logs,
  data,
  clientVersions,
  notifications,
  errors,
  errorRules,
  ...strings,
};
