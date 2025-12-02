import "server-only";

/**
 * Repository 层统一导出
 * 提供所有数据访问接口的统一入口
 */

// Key related exports
export {
  countActiveKeysByUser,
  createKey,
  deleteKey,
  findActiveKeyByKeyString,
  findActiveKeyByUserIdAndName,
  findKeyById,
  findKeyList,
  findKeyUsageToday,
  updateKey,
  validateApiKeyAndGetUser,
} from "./key";
// Message related exports
export {
  createMessageRequest,
  findLatestMessageRequestByKey,
  updateMessageRequestCost,
  updateMessageRequestDuration,
} from "./message";
// Model price related exports
export {
  createModelPrice,
  findAllLatestPrices,
  findLatestPriceByModel,
  hasAnyPriceRecords,
} from "./model-price";
// Provider related exports
export {
  createProvider,
  deleteProvider,
  findProviderById,
  findProviderList,
  getDistinctProviderGroups,
  updateProvider,
} from "./provider";
// Statistics related exports
export {
  getActiveKeysForUserFromDB,
  getActiveUsersFromDB,
  getKeyStatisticsFromDB,
  getUserStatisticsFromDB,
} from "./statistics";
// System settings related exports
export { getSystemSettings, updateSystemSettings } from "./system-config";
// User related exports
export { createUser, deleteUser, findUserById, findUserList, updateUser } from "./user";
