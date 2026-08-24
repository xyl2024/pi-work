// 领域图标层：文件图标和 Provider 图标保留各自的查找策略，避免混入基础操作图标。
export {
  CwdIcon,
  FolderIcon as FileTreeFolderIcon,
  getFileIcon,
  lookupFileIconName,
  lookupFolderIconName,
} from "@/components/files/FileIcons";
export {
  ProviderIcon,
  ProviderGearIcon,
  PROVIDER_ICON_IDS,
  hasProviderIcon,
  resolveProviderIcon,
} from "@/components/ui/ProviderIcon";
